package com.codebasenotes.jetbrains

import com.intellij.ide.projectView.PresentationData
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.ViewSettings
import com.intellij.ide.util.treeView.AbstractTreeNode
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.util.Segment
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.SmartPointerManager
import com.intellij.psi.SmartPsiElementPointer
import com.intellij.testFramework.HeavyPlatformTestCase
import com.intellij.testFramework.LightVirtualFile
import java.nio.file.Files

class ProjectViewNoteTargetResolverTest : HeavyPlatformTestCase() {
    fun testDirectVirtualFilesDoNotDependOnLanguageOrExtension() {
        val paths = listOf(
            "src/Main.java",
            "src/tool.py",
            "src/model.kt",
            "assets/schema.unknown-language",
            "scripts/NO_EXTENSION",
        )

        for (path in paths) {
            val file = addFileToProject(path, "content").virtualFile
            val node = TestProjectViewNode(project, file, file)

            assertEquals(path, ProjectViewNoteTargetResolver.resolveForDecoration(node)?.key)
        }
    }

    fun testPsiBackedSurrogateIsDecoratedWhenParentRepresentsDirectory() {
        val psiFile = addFileToProject("src/SendBackItem.kt", "data class SendBackItem(val id: String)")
        val symbol = requireNotNull(psiFile.firstChild)
        assertSame(psiFile, symbol.containingFile)
        val parent = TestProjectViewNode(project, requireNotNull(psiFile.parent))
        val surrogate = TestProjectViewNode(project, symbol).also { it.setParent(parent) }

        val target = ProjectViewNoteTargetResolver.resolveForDecoration(surrogate)

        assertNotNull(target)
        assertEquals("src/SendBackItem.kt", target!!.key)
        assertSame(psiFile.virtualFile, target.file)
    }

    fun testMemberIsSkippedWhenAncestorRepresentsSameFile() {
        val psiFile = addFileToProject("src/DeliveryInfo.java", "class DeliveryInfo {}")
        val symbol = requireNotNull(psiFile.firstChild)
        val fileNode = TestProjectViewNode(project, psiFile.virtualFile, psiFile.virtualFile)
        val memberNode = TestProjectViewNode(project, symbol, psiFile.virtualFile)
            .also { it.setParent(fileNode) }

        assertEquals(
            "src/DeliveryInfo.java",
            ProjectViewNoteTargetResolver.resolveForDecoration(fileNode)?.key,
        )
        assertNull(ProjectViewNoteTargetResolver.resolveForDecoration(memberNode))
    }

    fun testSameFileGrandparentAlsoSuppressesDuplicate() {
        val psiFile = addFileToProject("src/nested.py", "value = 1")
        val symbol = requireNotNull(psiFile.firstChild)
        val fileNode = TestProjectViewNode(project, psiFile.virtualFile, psiFile.virtualFile)
        val opaqueParent = TestProjectViewNode(project, Any()).also { it.setParent(fileNode) }
        val memberNode = TestProjectViewNode(project, symbol).also { it.setParent(opaqueParent) }

        assertNull(ProjectViewNoteTargetResolver.resolveForDecoration(memberNode))
    }

    fun testDetachedSymbolFailsClosedButCanStillBeResolvedForActions() {
        val psiFile = addFileToProject("src/detached.txt", "symbol")
        val symbol = requireNotNull(psiFile.firstChild)
        val detached = TestProjectViewNode(project, symbol)

        assertNull(ProjectViewNoteTargetResolver.resolveForDecoration(detached))
        assertEquals("src/detached.txt", ProjectViewNoteTargetResolver.resolve(detached)?.key)
    }

    fun testNonLocalAndMultiRootNodesFailClosed() {
        val local = addFileToProject("src/local.txt", "local").virtualFile
        val another = addFileToProject("src/another.txt", "another").virtualFile
        val multiRoot = TestProjectViewNode(
            project,
            Any(),
            local,
            listOf(local, another),
        )

        assertNull(ProjectViewNoteTargetResolver.resolveForDecoration(multiRoot))
        assertNull(
            ProjectViewNoteTargetResolver.resolve(
                project,
                LightVirtualFile("memory.txt", "memory"),
                null,
            ),
        )
    }

    fun testSharedActionResolverFallsBackToPsiElement() {
        val psiFile = addFileToProject("src/action-target.md", "target")
        val symbol: PsiElement = requireNotNull(psiFile.firstChild)

        val target = ProjectViewNoteTargetResolver.resolve(project, null, symbol)

        assertEquals("src/action-target.md", target?.key)
        assertSame(psiFile.virtualFile, target?.file)
    }

    fun testPsiDirectoryAndLiveSmartPointerResolveWithoutDirectVirtualFile() {
        val psiFile = addFileToProject("src/pointers/live.kt", "class Live")
        val directory = requireNotNull(psiFile.parent)
        val directoryTarget = ProjectViewNoteTargetResolver.resolveForDecoration(
            TestProjectViewNode(project, directory),
        )
        assertEquals("src/pointers", directoryTarget?.key)

        val symbol = requireNotNull(psiFile.firstChild)
        val pointer = SmartPointerManager.createPointer(symbol)
        val parent = TestProjectViewNode(project, directory)
        val pointerNode = TestProjectViewNode(project, pointer).also { it.setParent(parent) }

        assertEquals(
            "src/pointers/live.kt",
            ProjectViewNoteTargetResolver.resolveForDecoration(pointerNode)?.key,
        )
    }

    fun testLocalFileOutsideProjectRootFailsClosed() {
        val path = Files.createTempFile("codebase-notes-outside-", ".txt")
        val outside = requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path))

        try {
            assertNull(ProjectViewNoteTargetResolver.resolve(project, outside, null))
        } finally {
            Files.deleteIfExists(path)
        }
    }

    fun testStaleSmartPointerDoesNotLeakItsRetainedVirtualFile() {
        val file = addFileToProject("src/stale.txt", "stale").virtualFile
        val node = TestProjectViewNode(project, StalePointer(project, file), file)

        assertNull(ProjectViewNoteTargetResolver.resolve(node))
        assertNull(ProjectViewNoteTargetResolver.resolveForDecoration(node))
    }

    private fun addFileToProject(relativePath: String, text: String): PsiFile {
        val segments = relativePath.split('/')
        var parent = getOrCreateProjectBaseDir()
        for (segment in segments.dropLast(1)) {
            parent = parent.findChild(segment) ?: createChildDirectory(parent, segment)
        }
        val file = parent.findChild(segments.last()) ?: createChildData(parent, segments.last())
        setFileText(file, text)
        return requireNotNull(psiManager.findFile(file))
    }

    private class TestProjectViewNode(
        project: Project,
        value: Any,
        private val directFile: VirtualFile? = null,
        private val explicitRoots: Collection<VirtualFile>? = null,
    ) : ProjectViewNode<Any>(project, value, ViewSettings.DEFAULT) {
        override fun getVirtualFile(): VirtualFile? = directFile

        override fun getRoots(): Collection<VirtualFile> = explicitRoots ?: super.getRoots()

        override fun contains(file: VirtualFile): Boolean = directFile == file

        override fun getChildren(): Collection<AbstractTreeNode<*>> = emptyList()

        override fun update(data: PresentationData) = Unit
    }

    private class StalePointer(
        private val project: Project,
        private val file: VirtualFile,
    ) : SmartPsiElementPointer<PsiElement> {
        override fun getElement(): PsiElement? = null

        override fun getContainingFile(): PsiFile? = null

        override fun getProject(): Project = project

        override fun getVirtualFile(): VirtualFile = file

        override fun getRange(): Segment? = null

        override fun getPsiRange(): Segment? = null
    }
}
