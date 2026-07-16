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
    fun `serializer preserves unknown fields and uses stable order`() {
        val parsed = assertIs<ParseResult.WritableV1>(ConfigParser.parse(
            """{"z":true,"notes":{"b":{"future":1,"text":"B"},"a":{"style":"info","text":"A"}},"version":1,"a":false}"""
                .toByteArray(),
        ))
        val text = ConfigSerializer.serialize(parsed.document).toString(Charsets.UTF_8)

        assertEquals(
            """{
  "version": 1,
  "notes": {
    "a": {
      "text": "A",
      "style": "info"
    },
    "b": {
      "text": "B",
      "future": 1
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

    private fun note(text: String): ObjectNode = ConfigParser.mapper.createObjectNode().put("text", text)
}
