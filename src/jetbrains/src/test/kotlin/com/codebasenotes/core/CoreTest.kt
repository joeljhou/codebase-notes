package com.codebasenotes.core

import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CoreTest {
    @TempDir
    lateinit var temporaryDirectory: Path

    @Test
    fun `style selector exposes the six code map meanings`() {
        assertEquals(
            listOf(
                NoteStyle.CORE,
                NoteStyle.FOCUS,
                NoteStyle.IMPORTANT,
                NoteStyle.STABLE,
                NoteStyle.EXTENSION,
                NoteStyle.DEFAULT,
            ),
            NoteStyle.selectable,
        )
    }

    @Test
    fun `serializer preserves unknown fields and uses stable order`() {
        val parsed = assertIs<ParseResult.Writable>(ConfigParser.parse(
            """{"z":true,"notes":{"b":{"future":1,"text":"B"},"a":{"style":"important","text":"A"}},"version":1,"a":false}"""
                .toByteArray(),
        ))
        val text = ConfigSerializer.serialize(parsed.document).toString(Charsets.UTF_8)

        assertEquals(
            """{
  "version": 2,
  "notes": {
    "a": {
      "_text": "A",
      "_meta": {
        "style": "important"
      }
    },
    "b": {
      "_text": "B",
      "_meta": {
        "future": 1
      }
    }
  },
  "a": false,
  "z": true
}
""",
            text,
        )
    }

    @Test
    fun `text and style edits preserve the other note fields`() {
        val original = ConfigParser.mapper.createObjectNode().apply {
            put("text", "old")
            put("style", "important")
            putObject("future").put("enabled", true)
        }

        val textEdited = noteWithText(original, "new")
        assertEquals("new", textEdited.path("text").textValue())
        assertEquals("important", textEdited.path("style").textValue())
        assertTrue(textEdited.path("future").path("enabled").booleanValue())

        val focus = noteWithStyle(textEdited, NoteStyle.FOCUS)
        assertEquals("focus", focus.path("style").textValue())
        assertEquals("new", focus.path("text").textValue())

        val default = noteWithStyle(focus, NoteStyle.DEFAULT)
        assertTrue(!default.has("style"))
        assertEquals("new", default.path("text").textValue())
    }

    @Test
    fun `failed rename keeps original bytes`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val original = """{"version":1,"notes":{}}""".toByteArray()
        Files.write(path, original)
        val store = AtomicFileStore(hooks = AtomicFileHooks(beforeRename = { _, _ -> error("injected") }))

        val result = runCatching { store.atomicReplace(path, "replacement".toByteArray()) }

        assertTrue(result.isFailure)
        assertContentEquals(original, Files.readAllBytes(path))
        assertEquals(0, Files.list(temporaryDirectory).use { entries ->
            entries.filter { it.fileName.toString().contains(".tmp.") }.count()
        })
    }

    @Test
    fun `repository merges edits on different keys and rejects same key conflict`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val repository = ConfigRepository()
        val created = assertIs<CommitResult.Committed>(repository.create(path)).snapshot

        val noteA = note("A")
        val noteB = note("B")
        assertIs<CommitResult.Committed>(repository.setNote(created, "a.ts", noteA))
        val merged = assertIs<CommitResult.Committed>(repository.setNote(created, "b.ts", noteB))
        assertEquals("A", merged.snapshot.document.notes.path("a.ts").path("text").textValue())
        assertEquals("B", merged.snapshot.document.notes.path("b.ts").path("text").textValue())

        val conflict = repository.setNote(created, "a.ts", note("mine"))
        assertEquals(listOf("a.ts"), assertIs<CommitResult.Conflict>(conflict).paths)
    }

    @Test
    fun `stale lock is reclaimed only for dead same-host process`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val lockPath = temporaryDirectory.resolve("$CONFIG_FILE_NAME.lock")
        val now = java.time.Instant.parse("2026-07-17T00:00:00Z")
        val clock = java.time.Clock.fixed(now, java.time.ZoneOffset.UTC)
        Files.writeString(
            lockPath,
            """{"token":"old","pid":999999,"hostname":"test-host","createdAt":${now.toEpochMilli() - 60_000}}""",
        )
        val store = AtomicFileStore(
            staleLockMillis = 30_000,
            clock = clock,
            hostname = "test-host",
            isProcessAlive = { false },
        )

        val value = store.withLock(path) { 42 }

        assertEquals(42, value)
        assertTrue(Files.notExists(lockPath))
    }

    @Test
    fun `active lock fails closed without deleting its owner`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val lockPath = temporaryDirectory.resolve("$CONFIG_FILE_NAME.lock")
        Files.writeString(
            lockPath,
            """{"token":"owner","pid":1,"hostname":"test-host","createdAt":0}""",
        )
        val store = AtomicFileStore(
            lockTimeoutMillis = 0,
            staleLockMillis = 0,
            hostname = "test-host",
            isProcessAlive = { true },
        )

        val result = runCatching { store.withLock(path) { error("不应执行") } }

        assertTrue(result.isFailure)
        assertTrue(Files.exists(lockPath))
    }

    @Test
    fun `symlink config is readable but never atomically replaced`() {
        val target = temporaryDirectory.resolve("target.json")
        val link = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        Files.writeString(target, """{"version":1,"notes":{}}""")
        Files.createSymbolicLink(link, target.fileName)
        val repository = ConfigRepository()
        val loaded = assertIs<LoadResult.Loaded>(repository.load(link)).snapshot

        val result = repository.setNote(loaded, "a.ts", note("A"))

        assertIs<CommitResult.Failed>(result)
        assertEquals(0, ConfigParser.mapper.readTree(Files.readAllBytes(target)).path("notes").size())
        assertTrue(Files.isSymbolicLink(link))
    }

    @Test
    fun `commit preserves latest unknown root fields from disk`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val repository = ConfigRepository()
        val base = assertIs<CommitResult.Committed>(repository.create(path)).snapshot
        Files.writeString(
            path,
            """{"version":1,"notes":{},"external":{"kept":true}}""",
        )

        val committed = assertIs<CommitResult.Committed>(repository.setNote(base, "a.ts", note("A")))

        assertTrue(committed.snapshot.document.root.path("external").path("kept").booleanValue())
    }

    @Test
    fun `repository boundary rejects invalid notes from non UI callers`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val repository = ConfigRepository()
        val base = assertIs<CommitResult.Committed>(repository.create(path)).snapshot
        val before = Files.readAllBytes(path)

        val result = repository.setNote(base, "a.ts", note("x".repeat(2_001)))

        assertIs<CommitResult.Failed>(result)
        assertContentEquals(before, Files.readAllBytes(path))
    }

    @Test
    fun `legacy files migrate on successful save including unchanged values and then stay unchanged`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val legacy = """{"version":1,"notes":{".":{"text":"项目"},"src":{"text":"源码","style":"default","future":{"kept":true}},"src/a":{"text":"A"},"empty":{"text":"空目录"}},"external":[null,true]}"""
        Files.writeString(path, legacy)
        val repository = ConfigRepository()
        val base = assertIs<LoadResult.Loaded>(repository.load(path)).snapshot
        assertEquals(1, base.document.version)
        assertEquals(legacy, Files.readString(path))

        val migrated = assertIs<CommitResult.Committed>(repository.setNote(base, "src", base.document.notes.get("src") as ObjectNode)).snapshot
        assertEquals(2, migrated.document.version)
        assertEquals(base.document.notes, migrated.document.notes)
        assertEquals(base.document.root.get("external"), migrated.document.root.get("external"))
        val stored = ConfigParser.mapper.readTree(Files.readAllBytes(path))
        assertEquals("项目", stored.path("notes").path("_text").textValue())
        assertEquals("A", stored.path("notes").path("src").path("a").textValue())
        assertEquals("default", stored.path("notes").path("src").path("_meta").path("style").textValue())
        val bytes = Files.readAllBytes(path)
        assertIs<CommitResult.NoChange>(repository.commit(migrated, emptyMap()))
        assertContentEquals(bytes, Files.readAllBytes(path))
    }

    @Test
    fun `create migrates a valid legacy file without removing notes`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        Files.writeString(path, """{"version":1,"notes":{"a":{"text":"A"}}}""")
        val repository = ConfigRepository()
        val migrated = assertIs<CommitResult.Committed>(repository.create(path)).snapshot
        assertEquals(2, migrated.document.version)
        assertEquals("A", migrated.document.notes.path("a").path("text").textValue())
        assertIs<CommitResult.NoChange>(repository.create(path))
    }

    @Test
    fun `parent deletion preserves children and moving preserves metadata before pruning empty branches`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        Files.writeString(path, """{"version":2,"notes":{"src":{"_text":"目录","nested":{"a":{"_text":"A","_meta":{"style":"focus","custom":[null,true]}}}},"empty":"空目录"}}""")
        val repository = ConfigRepository()
        val base = assertIs<LoadResult.Loaded>(repository.load(path)).snapshot
        val removed = assertIs<CommitResult.Committed>(repository.setNote(base, "src", null)).snapshot
        val moved = assertIs<CommitResult.Committed>(repository.move(removed, "src", "new")).snapshot
        assertEquals("focus", moved.document.notes.path("new/nested/a").path("style").textValue())
        assertEquals(base.document.notes.path("src/nested/a"), moved.document.notes.path("new/nested/a"))
        assertIs<CommitResult.Committed>(repository.setNote(moved, "new/nested/a", null))
        assertEquals(ConfigParser.mapper.readTree("""{"empty":"空目录"}"""), ConfigParser.mapper.readTree(Files.readAllBytes(path)).path("notes"))
    }

    @Test
    fun `old snapshots merge after another client migrated while preserving latest disk root metadata`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        Files.writeString(path, """{"version":1,"notes":{"a":{"text":"A"}},"external":1}""")
        val repository = ConfigRepository()
        val base = assertIs<LoadResult.Loaded>(repository.load(path)).snapshot
        assertIs<CommitResult.Committed>(repository.commit(base, emptyMap()))
        val disk = ConfigParser.mapper.readTree(Files.readAllBytes(path)) as ObjectNode
        Files.write(path, ConfigParser.mapper.writeValueAsBytes(disk.put("external", 2)))
        val result = assertIs<CommitResult.Committed>(repository.setNote(base, "b", note("B"))).snapshot
        assertEquals(2, result.document.root.path("external").intValue())
        assertEquals("A", result.document.notes.path("a").path("text").textValue())
        assertEquals("B", result.document.notes.path("b").path("text").textValue())
        assertIs<CommitResult.NoChange>(repository.setNote(base, "b", note("B")))
    }

    @Test
    fun `special filenames survive creation move conflict detection and deletion`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val repository = ConfigRepository()
        var base = assertIs<CommitResult.Committed>(repository.create(path)).snapshot
        base = assertIs<CommitResult.Committed>(repository.setNote(base, "__proto__", note("原型名"))).snapshot
        base = assertIs<CommitResult.Committed>(repository.setNote(base, "constructor", note("构造器名"))).snapshot
        assertIs<CommitResult.Conflict>(repository.move(base, "__proto__", "constructor"))
        base = assertIs<CommitResult.Committed>(repository.move(base, "__proto__", "toString")).snapshot
        base = assertIs<CommitResult.Committed>(repository.setNote(base, "constructor", null)).snapshot
        assertEquals(ConfigParser.mapper.readTree("""{"toString":{"text":"原型名"}}"""), base.document.notes)
    }

    @Test
    fun `failed migrations conflicts invalid trees and future formats keep original bytes`() {
        val path = temporaryDirectory.resolve(CONFIG_FILE_NAME)
        val legacy = """{"version":1,"notes":{"a":{"text":"A"}}}"""
        Files.writeString(path, legacy)
        val repository = ConfigRepository()
        val base = assertIs<LoadResult.Loaded>(repository.load(path)).snapshot
        val failing = ConfigRepository(fileStore = AtomicFileStore(hooks = AtomicFileHooks(
            beforeRename = { _, _ -> error("migration failure") },
        )))
        assertIs<CommitResult.Failed>(failing.commit(base, emptyMap()))
        assertEquals(legacy, Files.readString(path))
        val changed = legacy.replace("\"A\"", "\"disk\"")
        Files.writeString(path, changed)
        assertIs<CommitResult.Conflict>(repository.setNote(base, "a", note("mine")))
        assertEquals(changed, Files.readString(path))
        for (text in listOf("""{"version":2,"notes":{"a":{"_meta":{}}}}""", """{"version":3,"notes":"future"}""")) {
            Files.writeString(path, text)
            val result = repository.setNote(base, "a", note("A"))
            assertTrue(result is CommitResult.Failed || result is CommitResult.Readonly)
            assertEquals(text, Files.readString(path))
        }
    }

    private fun note(text: String): ObjectNode = ConfigParser.mapper.createObjectNode().put("text", text)
}
