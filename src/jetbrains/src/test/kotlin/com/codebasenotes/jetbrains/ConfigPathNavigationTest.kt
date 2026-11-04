package com.codebasenotes.jetbrains

import com.codebasenotes.core.CONFIG_FILE_NAME
import com.intellij.codeInsight.navigation.CtrlMouseData
import com.intellij.codeInsight.navigation.actions.GotoDeclarationAction
import com.intellij.codeInsight.navigation.actions.GotoDeclarationHandler
import com.intellij.ide.projectView.ProjectView
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.impl.ProjectViewImpl
import com.intellij.ide.projectView.impl.ProjectViewPane
import com.intellij.json.psi.JsonFile
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.roots.ModuleRootModificationUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowId
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.testFramework.HeavyPlatformTestCase
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.ProjectViewTestUtil
import com.intellij.testFramework.TestActionEvent
import com.intellij.testFramework.replaceService
import com.intellij.toolWindow.ToolWindowHeadlessManagerImpl
import java.util.concurrent.CompletableFuture

class ConfigPathNavigationTest : HeavyPlatformTestCase() {
    fun testCompactedPathsAndDescendants() {
        addFile("src/main/java/cn/geekyspace/app/Main.kt")
        assertResolved(
            """{"version":3,"notes":{"src/main/java":{"cn/geekyspace/a<caret>pp":{"Main.kt":"entry"}}}}""",
            "src/main/java/cn/geekyspace/app",
        )
        assertResolved(
            """{"version":3,"notes":{"src/main/java":{"cn/geekyspace/app":{"M<caret>ain.kt":"entry"}}}}""",
            "src/main/java/cn/geekyspace/app/Main.kt",
        )
        addFile("_private/_text/cn.example/Main.kt")
        assertResolved(
            """{"version":3,"notes":{"__private/__text/cn.ex<caret>ample":{"Main.kt":"entry"}}}""",
            "_private/_text/cn.example",
        )
    }

    fun testNestedPathsAndStructuralDirectories() {
        addFile("src/main/App.kt")
        assertResolved(
            """{"version":3,"notes":{"src":{"main":{"A<caret>pp.kt":"entry"}}}}""",
            "src/main/App.kt",
        )
        assertResolved(
            """{"version":3,"notes":{"s<caret>rc":{"main":{"App.kt":"entry"}}}}""",
            "src",
        )
        assertResolved(
            """{"version":3,"notes":{"src":{"m<caret>ain":{"_text":"main sources","_meta":{"style":"core"}}}}}""",
            "src/main",
        )
    }

    fun testEscapedUnderscoreSegmentsAndReservedNames() {
        addFile("_private/_text/__file.kt")
        assertResolved(
            """{"version":3,"notes":{"__private":{"__text":{"___f<caret>ile.kt":"entry"}}}}""",
            "_private/_text/__file.kt",
        )
        assertResolved("""{"version":3,"notes":{"__p<caret>rivate":"private"}}""", "_private")
    }

    fun testUnicodeSpacesAndJsonEscapes() {
        addFile("文档/hello world.txt")
        addFile("quote\"name.txt")
        assertResolved(
            """{"version":3,"notes":{"\u6587\u6863":{"hello w<caret>orld.txt":"说明"}}}""",
            "文档/hello world.txt",
        )
        assertResolved(
            """{"version":3,"notes":{"quote\"n<caret>ame.txt":"quoted name"}}""",
            "quote\"name.txt",
        )
    }

    fun testMetadataAndNoteTextAreNeverPaths() {
        addFile("src/_text")
        addFile("src/_meta/style")
        addFile("src/style")
        val examples = listOf(
            """{"version":3,"notes":{"src":{"_<caret>text":"note"}}}""",
            """{"version":3,"notes":{"src":{"_text":"note","_<caret>meta":{"style":"core"}}}}""",
            """{"version":3,"notes":{"src":{"_text":"note","_meta":{"s<caret>tyle":"core"}}}}""",
            """{"version":3,"notes":{"src":"s<caret>rc"}}""",
            """{"version":1,"notes":{"src":{"t<caret>ext":"source","style":"core"}}}""",
            """{"version":1,"notes":{"src":{"text":"source","s<caret>tyle":"core"}}}""",
            """{"version":3,"notes":{"src":{"_text":"note","_meta":{"src":{"s<caret>tyle":"core"}}}}}""",
        )
        for (text in examples) assertNull(text, resolve(text))
    }

    fun testTopLevelAndExtensionPropertiesAreNotPaths() {
        addFile("version")
        addFile("notes")
        addFile("extension/src")
        for (text in listOf(
            """{"v<caret>ersion":2,"notes":{}}""",
            """{"version":3,"n<caret>otes":{}}""",
            """{"version":3,"notes":{},"extension":{"s<caret>rc":"other"}}""",
        )) assertNull(text, resolve(text))
    }

    fun testInvalidOrNonexistentPathsFailClosed() {
        addFile("src/Main.kt")
        for (key in listOf("../src/Main.kt", "/src/Main.kt", "src/../Main.kt", "src//Main.kt", "src/", "C:/src/Main.kt", "missing")) {
            assertNull(key, resolve("""{"version":1,"notes":{"<caret>${key}":{"text":"note"}}}"""))
        }
        for (key in listOf(".", "..", "_private", "_text", "_meta", "src//Main.kt", "missing", CONFIG_FILE_NAME)) {
            assertNull(key, resolve("""{"version":3,"notes":{"<caret>${key}":"note"}}"""))
        }
        assertNull(resolve("""{"version":3,"notes":{"src":{"..<caret>":{"Main.kt":"note"}}}}"""))
        assertNull(resolve("""{"version":1,"notes":{".codebase-notes.j<caret>son":{"text":"self"}}}"""))
    }

    fun testUnsupportedVersionsAndNonTreeValuesFailClosed() {
        addFile("src/Main.kt")
        for (version in listOf("0", "1", "2", "4", "3.0", "\"3\"", "null")) {
            assertNull(version, resolve("""{"version":$version,"notes":{"s<caret>rc":"note"}}"""))
        }
        for (value in listOf("null", "true", "1", "[]")) {
            assertNull(value, resolve("""{"version":3,"notes":{"s<caret>rc":$value}}"""))
        }
        assertNull(resolve("""{"notes":{"s<caret>rc":"note"}}"""))
        assertNull(resolve("""{"version":3,"notes":{"s<caret>rc":}}"""))
        assertNull(resolve("""{"version":3,"notes":{"s<caret>rc"""))
    }

    fun testOtherJsonAndNestedConfigurationsAreIgnored() {
        addFile("src/Main.kt")
        val text = """{"version":3,"notes":{"s<caret>rc":"note"}}"""
        assertNull(resolve(text, "other.json"))
        assertNull(resolve(text, "src/$CONFIG_FILE_NAME"))
    }

    fun testQuotesAndPunctuationAreNotNavigationTargets() {
        addFile("src/Main.kt")
        for (text in listOf(
            """{"version":3,"notes":{<caret>"src":"note"}}""",
            """{"version":3,"notes":{"src<caret>":"note"}}""",
            """{"version":3,"notes":{"src"<caret>:"note"}}""",
        )) assertNull(text, resolve(text))
    }

    fun testCurrentUnsavedPsiIsUsed() {
        addFile("src/Main.kt")
        val config = addFile(CONFIG_FILE_NAME, """{"version":3,"notes":{}}""")
        val manager = FileDocumentManager.getInstance()
        val document = requireNotNull(manager.getDocument(config))
        val text = """{"version":3,"notes":{"src":{"Main.kt":"unsaved"}}}"""
        WriteCommandAction.runWriteCommandAction(project) { document.setText(text) }
        PsiDocumentManager.getInstance(project).commitDocument(document)
        val psi = requireNotNull(psiManager.findFile(config))
        val offset = text.indexOf("Main.kt") + 2

        val target = ConfigPathResolver.resolve(requireNotNull(psi.findElementAt(offset)), offset)

        assertTrue(manager.isDocumentUnsaved(document))
        assertEquals("src/Main.kt", target?.key)
        manager.saveDocument(document)
    }

    fun testCompactedNativeHandlerAndCtrlMouseHoverAreRegistered() {
        addFile("src/Main.kt")
        withEditor("""{"version":3,"notes":{"src/M<caret>ain.kt":"entry"}}""") { editor, psi, offset ->
            assertTrue(GotoDeclarationHandler.EP_NAME.extensionList.any { it is ConfigPathGotoDeclarationHandler })
            val target = GotoDeclarationAction.findTargetElement(project, editor, offset)
            assertTrue(target is ConfigPathNavigationElement)
            assertEquals("src/Main.kt", (target as ConfigPathNavigationElement).name)
            assertTrue(target.canNavigate())
            assertFalse(target.canNavigateToSource())
            assertNull(target.containingFile)

            val hover = PlatformTestUtil.waitForFuture(CompletableFuture.supplyAsync {
                ReadAction.compute<CtrlMouseData?, RuntimeException> {
                    GotoDeclarationAction().getCtrlMouseData(editor, psi, offset)
                }
            })
            assertNotNull(hover)
            assertTrue(hover!!.isNavigatable)
            assertTrue(hover.ranges.any { it.contains(offset) })
        }
    }

    fun testFileNavigationSelectsInProjectViewWithoutOpeningEditor() {
        val file = addFile("src/Main.kt")
        setupProjectView()
        val view = ProjectView.getInstance(project) as ProjectViewImpl
        view.setAutoscrollToSource(true, ProjectViewPane.ID)
        val editors = FileEditorManager.getInstance(project)
        val openBefore = editors.openFiles.toSet()

        withEditor("""{"version":3,"notes":{"src/M<caret>ain.kt":"entry"}}""") { editor, psi, _ ->
            val context = SimpleDataContext.builder()
                .add(CommonDataKeys.PROJECT, project)
                .add(CommonDataKeys.EDITOR, editor)
                .add(CommonDataKeys.PSI_FILE, psi)
                .build()
            val action = GotoDeclarationAction()
            action.actionPerformed(TestActionEvent.createTestEvent(action, context))
            waitForSelection(file)
        }

        PlatformTestUtil.waitForAlarm(750)
        assertEquals(openBefore, editors.openFiles.toSet())
        assertFalse(editors.isFileOpen(file))
        assertTrue(view.isAutoscrollToSource(ProjectViewPane.ID))
    }

    fun testDirectoryNavigationSelectsAndExpandsOnlyTheTargetDirectory() {
        val file = addFile("src/nested/child.txt")
        val directory = requireNotNull(file.parent)
        setupProjectView()
        val editors = FileEditorManager.getInstance(project)
        val openBefore = editors.openFiles.toSet()

        PlatformTestUtil.waitForCallback(ProjectTreePathNavigator.select(project, directory))
        waitForSelection(directory)

        val pane = requireNotNull(ProjectView.getInstance(project).currentProjectViewPane)
        PlatformTestUtil.waitWhileBusy(pane.tree)
        assertTrue(pane.tree.isExpanded(pane.selectedPath))
        assertEquals(openBefore, editors.openFiles.toSet())
    }

    fun testDeletedTargetCannotNavigate() {
        val file = addFile("src/Main.kt")
        withEditor("""{"version":3,"notes":{"src/M<caret>ain.kt":"entry"}}""") { editor, _, offset ->
            val target = GotoDeclarationAction.findTargetElement(project, editor, offset) as ConfigPathNavigationElement
            WriteCommandAction.runWriteCommandAction(project) { file.delete(this) }
            assertFalse(target.isValid)
            assertFalse(target.canNavigate())
            target.navigate(true)
            assertTrue(ProjectTreePathNavigator.select(project, file).isRejected)
        }
    }

    private fun assertResolved(text: String, key: String) {
        val target = resolve(text)
        assertNotNull(text, target)
        assertEquals(key, target!!.key)
        assertEquals(
            if (key == ".") getOrCreateProjectBaseDir() else getOrCreateProjectBaseDir().findFileByRelativePath(key),
            target.file,
        )
    }

    private fun resolve(text: String, configPath: String = CONFIG_FILE_NAME): ConfigPathTarget? {
        val offset = text.indexOf("<caret>")
        require(offset >= 0)
        val file = addFile(configPath, text.replace("<caret>", ""))
        val psi = requireNotNull(psiManager.findFile(file))
        assertTrue(psi is JsonFile)
        return psi.findElementAt(offset)?.let { ConfigPathResolver.resolve(it, offset) }
    }

    private fun withEditor(text: String, action: (Editor, JsonFile, Int) -> Unit) {
        val offset = text.indexOf("<caret>")
        val file = addFile(CONFIG_FILE_NAME, text.replace("<caret>", ""))
        val document = requireNotNull(FileDocumentManager.getInstance().getDocument(file))
        val editor = EditorFactory.getInstance().createEditor(document, project)
        try {
            editor.caretModel.moveToOffset(offset)
            action(editor, psiManager.findFile(file) as JsonFile, offset)
        } finally {
            EditorFactory.getInstance().releaseEditor(editor)
        }
    }

    private fun addFile(relativePath: String, text: String = "content"): VirtualFile {
        val segments = relativePath.split('/')
        var parent = getOrCreateProjectBaseDir()
        for (segment in segments.dropLast(1)) {
            parent = parent.findChild(segment) ?: createChildDirectory(parent, segment)
        }
        val file = parent.findChild(segments.last()) ?: createChildData(parent, segments.last())
        val document = requireNotNull(FileDocumentManager.getInstance().getDocument(file))
        WriteCommandAction.runWriteCommandAction(project) { document.setText(text) }
        PsiDocumentManager.getInstance(project).commitDocument(document)
        FileDocumentManager.getInstance().saveDocument(document)
        return file
    }

    private fun setupProjectView() {
        ModuleRootModificationUtil.addContentRoot(module, getOrCreateProjectBaseDir())
        // The platform's MockToolWindow ignores show callbacks; retain real Project View/tree behavior.
        val window = object : ToolWindowHeadlessManagerImpl.MockToolWindow(project) {
            private var shown = false

            override fun isVisible(): Boolean = shown

            override fun show(runnable: Runnable?) {
                shown = true
                runnable?.run()
            }

            override fun hide(runnable: Runnable?) {
                shown = false
                runnable?.run()
            }
        }
        val manager = object : ToolWindowHeadlessManagerImpl(project) {
            override fun getToolWindow(id: String?): ToolWindow? =
                if (id == ToolWindowId.PROJECT_VIEW) window else super.getToolWindow(id)
        }
        project.replaceService(ToolWindowManager::class.java, manager, testRootDisposable)
        ProjectViewTestUtil.setupImpl(project, true)
        window.hide()
    }

    private fun waitForSelection(file: VirtualFile) {
        PlatformTestUtil.waitWithEventsDispatching("select ${file.path}", {
            val pane = ProjectView.getInstance(project).currentProjectViewPane
            pane?.selectedUserObjects?.any {
                (it as? ProjectViewNode<*>)?.let(ProjectViewNoteTargetResolver::resolve)?.file == file
            } == true
        }, 10)
        assertEquals(ProjectViewPane.ID, ProjectView.getInstance(project).currentViewId)
        assertTrue(requireNotNull(ToolWindowManager.getInstance(project).getToolWindow(ToolWindowId.PROJECT_VIEW)).isVisible)
    }
}
