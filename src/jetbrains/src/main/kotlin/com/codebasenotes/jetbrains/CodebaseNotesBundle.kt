package com.codebasenotes.jetbrains

import com.codebasenotes.core.CoreLocalizer
import com.intellij.DynamicBundle
import org.jetbrains.annotations.Nls

private const val BUNDLE = "messages.CodebaseNotesBundle"

internal object CodebaseNotesBundle {
    private val instance = DynamicBundle(CodebaseNotesBundle::class.java, BUNDLE)

    fun message(key: String, vararg params: Any): @Nls String =
        instance.getMessage(key, *params)

    val coreLocalizer: CoreLocalizer = object : CoreLocalizer {
        override fun message(key: String, vararg params: Any): String =
            CodebaseNotesBundle.message(key, *params)
    }
}
