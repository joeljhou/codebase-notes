package com.codebasenotes.jetbrains

import com.codebasenotes.core.ConfigParser
import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.Test
import java.util.ArrayDeque
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class ProjectViewRefreshCoordinatorTest {
    @Test
    fun `requests waiting for the EDT merge their changed keys into one refresh`() {
        val dispatcher = ManualDispatcher()
        val target = ManualRefreshTarget()
        val coordinator = ProjectViewRefreshCoordinator(dispatcher, target)

        coordinator.requestRefresh(setOf("src/A.kt"))
        coordinator.requestRefresh(setOf("src/B.py", "src/A.kt"))
        coordinator.requestRefresh(setOf("src/C.java"))

        assertEquals(1, dispatcher.pendingCount)
        dispatcher.runNext()
        assertEquals(1, target.refreshCount)
        assertEquals(
            listOf(setOf("src/A.kt", "src/B.py", "src/C.java")),
            target.refreshKeys,
        )

        target.completeNext()
        dispatcher.runAll()

        assertEquals(1, target.refreshCount)
        assertEquals(0, dispatcher.pendingCount)
    }

    @Test
    fun `requests during an in-flight refresh become one follow-up pass`() {
        val dispatcher = ManualDispatcher()
        val target = ManualRefreshTarget()
        val coordinator = ProjectViewRefreshCoordinator(dispatcher, target)

        coordinator.requestRefresh(setOf("src/A.kt"))
        dispatcher.runNext()
        coordinator.requestRefresh(setOf("src/B.py"))
        coordinator.requestRefresh(setOf("src/C.java", "src/B.py"))

        target.completeNext()
        dispatcher.runNext()

        assertEquals(2, target.refreshCount)
        assertEquals(1, target.pendingCount)
        assertEquals(
            listOf(setOf("src/A.kt"), setOf("src/B.py", "src/C.java")),
            target.refreshKeys,
        )

        target.completeNext()
        dispatcher.runAll()

        assertEquals(2, target.refreshCount)
    }

    @Test
    fun `deleting a note while an old presentation is rendering finishes with the latest state`() {
        val dispatcher = ManualDispatcher()
        var publishedNote: String? = "哈哈"
        val target = CapturingRefreshTarget { publishedNote }
        val coordinator = ProjectViewRefreshCoordinator(dispatcher, target)
        val key = "src/DeliveryInfo.kt"

        coordinator.requestRefresh(setOf(key))
        dispatcher.runNext()

        // The state commit succeeds before its refresh is requested. The first Project View pass is
        // still holding the old presentation and may finish after the deletion.
        publishedNote = null
        coordinator.requestRefresh(setOf(key))
        target.completeNext()

        assertNull(publishedNote)
        assertEquals("哈哈", target.presentedNote)

        // Completing the old pass starts a serialized follow-up which reads the latest snapshot.
        dispatcher.runNext()
        target.completeNext()
        dispatcher.runAll()

        assertNull(target.presentedNote)
        assertEquals(2, target.refreshCount)
        assertEquals(listOf(setOf(key), setOf(key)), target.refreshKeys)
    }

    @Test
    fun `a completed coordinator accepts a later independent request`() {
        val dispatcher = ManualDispatcher()
        val target = ManualRefreshTarget()
        val coordinator = ProjectViewRefreshCoordinator(dispatcher, target)

        coordinator.requestRefresh(setOf("src/A.kt"))
        dispatcher.runNext()
        target.completeNext()
        dispatcher.runAll()

        coordinator.requestRefresh(setOf("src/B.py"))
        dispatcher.runNext()

        assertEquals(2, target.refreshCount)
        assertEquals(listOf(setOf("src/A.kt"), setOf("src/B.py")), target.refreshKeys)
    }

    @Test
    fun `dispose cancels a refresh that has not reached the EDT`() {
        val dispatcher = ManualDispatcher()
        val target = ManualRefreshTarget()
        val coordinator = ProjectViewRefreshCoordinator(dispatcher, target)

        coordinator.requestRefresh(setOf("src/A.kt"))
        coordinator.dispose()
        dispatcher.runAll()

        assertEquals(0, target.refreshCount)
    }

    @Test
    fun `a throwing refresh target does not permanently lock the coordinator`() {
        val dispatcher = ManualDispatcher()
        val refreshKeys = mutableListOf<Set<String>>()
        var failFirstRefresh = true
        val target = ProjectViewRefreshTarget { changedKeys, onProcessed ->
            refreshKeys += changedKeys
            if (failFirstRefresh) {
                failFirstRefresh = false
                throw IllegalStateException("stale Project View pane")
            }
            onProcessed()
        }
        val coordinator = ProjectViewRefreshCoordinator(dispatcher, target)

        coordinator.requestRefresh(setOf("src/A.kt"))
        assertFailsWith<IllegalStateException> { dispatcher.runNext() }
        dispatcher.runAll()

        coordinator.requestRefresh(setOf("src/B.py"))
        dispatcher.runAll()

        assertEquals(listOf(setOf("src/A.kt"), setOf("src/B.py")), refreshKeys)
        assertEquals(0, dispatcher.pendingCount)
    }

    @Test
    fun `changed note keys include additions removals and updates but not equal notes`() {
        val before = notes(
            "same.kt" to "same",
            "removed.py" to "gone",
            "updated.java" to "old",
        )
        val after = notes(
            "same.kt" to "same",
            "updated.java" to "new",
            "added.rs" to "hello",
        )

        assertEquals(
            setOf("removed.py", "updated.java", "added.rs"),
            changedNoteKeys(before, after),
        )
        assertEquals(emptySet(), changedNoteKeys(null, null))
    }

    private fun notes(vararg entries: Pair<String, String>): ObjectNode =
        ConfigParser.mapper.createObjectNode().apply {
            entries.forEach { (key, text) -> putObject(key).put("text", text) }
        }
}

private class ManualDispatcher : ProjectViewRefreshDispatcher {
    private val tasks = ArrayDeque<() -> Unit>()

    val pendingCount: Int
        get() = tasks.size

    override fun dispatch(action: () -> Unit) {
        tasks.addLast(action)
    }

    fun runNext() {
        check(tasks.isNotEmpty()) { "No dispatched task is waiting" }
        tasks.removeFirst().invoke()
    }

    fun runAll() {
        while (tasks.isNotEmpty()) runNext()
    }
}

private open class ManualRefreshTarget : ProjectViewRefreshTarget {
    private val completions = ArrayDeque<() -> Unit>()
    val refreshKeys = mutableListOf<Set<String>>()

    var refreshCount: Int = 0
        private set

    val pendingCount: Int
        get() = completions.size

    override fun refresh(changedKeys: Set<String>, onProcessed: () -> Unit) {
        refreshCount += 1
        refreshKeys += changedKeys.toSet()
        completions.addLast(onProcessed)
    }

    fun completeNext() {
        check(completions.isNotEmpty()) { "No Project View refresh is in flight" }
        completions.removeFirst().invoke()
    }
}

private class CapturingRefreshTarget(
    private val currentNote: () -> String?,
) : ProjectViewRefreshTarget {
    private data class PendingRefresh(
        val note: String?,
        val onProcessed: () -> Unit,
    )

    private val pending = ArrayDeque<PendingRefresh>()

    var refreshCount: Int = 0
        private set

    var presentedNote: String? = currentNote()
        private set

    val refreshKeys = mutableListOf<Set<String>>()

    override fun refresh(changedKeys: Set<String>, onProcessed: () -> Unit) {
        refreshCount += 1
        refreshKeys += changedKeys.toSet()
        pending.addLast(PendingRefresh(currentNote(), onProcessed))
    }

    fun completeNext() {
        check(pending.isNotEmpty()) { "No Project View refresh is in flight" }
        val completed = pending.removeFirst()
        presentedNote = completed.note
        completed.onProcessed()
    }
}
