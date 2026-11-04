package com.codebasenotes.jetbrains

import com.codebasenotes.core.CONFIG_FILE_NAME
import com.codebasenotes.core.CommitResult
import com.codebasenotes.core.ConfigParser
import com.codebasenotes.core.ParseResult
import com.fasterxml.jackson.databind.node.ObjectNode
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.testFramework.HeavyPlatformTestCase
import com.intellij.testFramework.PlatformTestUtil
import java.nio.file.Files
import java.util.concurrent.CompletableFuture

class CompactDirectoryMaintenanceTest : HeavyPlatformTestCase() {
    fun testVfsCreateDeleteAndRenameMaintainCompression() {
        val directory = addDirectory("src/main/java/cn/example/app/integration")
        addDirectory("src/main/java/cn/example/app/unit")
        val service = project.getService(CodebaseNotesProjectService::class.java)
        PlatformTestUtil.waitForFuture(service.refreshAsync())
        assertTrue(PlatformTestUtil.waitForFuture(service.setNote("src/main/java/cn/example/app/integration", "集成测试")) is CommitResult.Committed)
        waitForNotes { it.has("src/main/java/cn/example/app") }

        val parent = requireNotNull(getOrCreateProjectBaseDir().findFileByRelativePath("src/main"))
        val branch = WriteCommandAction.writeCommandAction(project).compute<VirtualFile, RuntimeException> {
            parent.createChildData(this, "README.md")
        }
        waitForNotes { it.path("src/main").has("java/cn/example/app") }
        WriteCommandAction.runWriteCommandAction(project) { branch.delete(this) }
        waitForNotes { it.has("src/main/java/cn/example/app") }

        WriteCommandAction.runWriteCommandAction(project) { directory.rename(this, "integration-new") }
        waitForNotes { it.path("src/main/java/cn/example/app").has("integration-new") }
        assertEquals("集成测试", service.noteFor(directory)?.path("text")?.textValue())
        val config = Files.readAllBytes(getOrCreateProjectBaseDir().toNioPath().resolve(CONFIG_FILE_NAME))
        val parsed = ConfigParser.parse(config) as ParseResult.Writable
        assertEquals("集成测试", parsed.document.notes.path("src/main/java/cn/example/app/integration-new").path("text").textValue())
    }

    fun testDirtyConfigurationIsNotOverwrittenAndSaveResumesMaintenance() {
        addDirectory("src/main/java/cn/example/app/integration")
        addDirectory("src/main/java/cn/example/app/unit")
        val service = project.getService(CodebaseNotesProjectService::class.java)
        PlatformTestUtil.waitForFuture(service.refreshAsync())
        PlatformTestUtil.waitForFuture(service.setNote("src/main/java/cn/example/app/integration", "集成测试"))
        waitForNotes { it.has("src/main/java/cn/example/app") }
        val path = getOrCreateProjectBaseDir().toNioPath().resolve(CONFIG_FILE_NAME)
        val original = Files.readString(path)
        val config = requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path))
        val documents = FileDocumentManager.getInstance()
        val document = requireNotNull(documents.getDocument(config))
        WriteCommandAction.runWriteCommandAction(project) { document.insertString(0, " ") }
        assertTrue(service.isConfigDocumentDirty())
        val main = requireNotNull(getOrCreateProjectBaseDir().findFileByRelativePath("src/main"))
        WriteCommandAction.runWriteCommandAction(project) { main.createChildData(this, "README.md") }
        PlatformTestUtil.waitForAlarm(400)
        assertEquals(original, Files.readString(path))
        documents.saveDocument(document)
        waitForNotes { it.path("src/main").has("java/cn/example/app") }
    }

    private fun waitForNotes(condition: (ObjectNode) -> Boolean) {
        val path = getOrCreateProjectBaseDir().toNioPath().resolve(CONFIG_FILE_NAME)
        PlatformTestUtil.waitForFuture(CompletableFuture.supplyAsync {
            val deadline = System.nanoTime() + 10_000_000_000L
            while (System.nanoTime() < deadline) {
                val notes = runCatching { ConfigParser.mapper.readTree(Files.readAllBytes(path)).path("notes") as ObjectNode }.getOrNull()
                if (notes != null && condition(notes)) return@supplyAsync
                Thread.sleep(25)
            }
            error("Timed out waiting for directory layout: ${Files.readString(path)}")
        })
    }

    private fun addDirectory(relative: String): VirtualFile {
        var parent = getOrCreateProjectBaseDir()
        for (segment in relative.split('/')) {
            parent = parent.findChild(segment) ?: createChildDirectory(parent, segment)
        }
        return parent
    }
}
