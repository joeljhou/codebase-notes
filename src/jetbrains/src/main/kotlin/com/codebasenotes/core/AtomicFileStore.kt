package com.codebasenotes.core

import com.fasterxml.jackson.databind.node.ObjectNode
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import java.time.Clock
import java.util.UUID

data class AtomicFileHooks(
    val afterTempSynced: ((Path) -> Unit)? = null,
    val beforeRename: ((Path, Path) -> Unit)? = null,
)

class FileStoreException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

class AtomicFileStore(
    private val lockTimeoutMillis: Long = 2_000,
    private val staleLockMillis: Long = 30_000,
    private val retryDelayMillis: () -> Long = { 20L + (Math.random() * 30).toLong() },
    private val clock: Clock = Clock.systemUTC(),
    private val hostname: String = runCatching { java.net.InetAddress.getLocalHost().hostName }.getOrDefault("unknown"),
    private val isProcessAlive: (Long) -> Boolean = { ProcessHandle.of(it).map(ProcessHandle::isAlive).orElse(false) },
    private val hooks: AtomicFileHooks = AtomicFileHooks(),
    private val localizer: CoreLocalizer = DefaultCoreLocalizer,
) {
    fun <T> withLock(configPath: Path, action: () -> T): T {
        val lockPath = configPath.resolveSibling("${configPath.fileName}.lock")
        val token = acquireLock(lockPath)
        return try {
            action()
        } finally {
            removeLockIfTokenMatches(lockPath, token)
        }
    }

    fun atomicReplace(configPath: Path, bytes: ByteArray) {
        if (Files.isSymbolicLink(configPath)) {
            throw FileStoreException(localizer.message("config.symlink"))
        }

        val temporaryPath = configPath.resolveSibling("${configPath.fileName}.tmp.${UUID.randomUUID()}")
        val oldPermissions = readPermissions(configPath)
        try {
            FileChannel.open(temporaryPath, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { channel ->
                var buffer = ByteBuffer.wrap(bytes)
                while (buffer.hasRemaining()) channel.write(buffer)
                channel.force(true)
            }
            oldPermissions?.let { Files.setPosixFilePermissions(temporaryPath, it) }
            hooks.afterTempSynced?.invoke(temporaryPath)
            hooks.beforeRename?.invoke(temporaryPath, configPath)

            // 同目录原子 rename 是唯一提交点；目标文件在这之前始终保持完整。
            try {
                Files.move(
                    temporaryPath,
                    configPath,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (unsupported: AtomicMoveNotSupportedException) {
                throw FileStoreException(localizer.message("config.atomic.unsupported"), unsupported)
            }
            syncDirectoryBestEffort(configPath.parent)
        } catch (error: Throwable) {
            Files.deleteIfExists(temporaryPath)
            if (error is FileStoreException) throw error
            throw FileStoreException(localizer.message("config.atomic.failed", error.message.orEmpty()), error)
        }
    }

    private fun acquireLock(lockPath: Path): String {
        val deadline = clock.millis() + lockTimeoutMillis
        val token = UUID.randomUUID().toString()
        val lock = ConfigParser.mapper.createObjectNode().apply {
            put("token", token)
            put("pid", ProcessHandle.current().pid())
            put("hostname", hostname)
            put("createdAt", clock.millis())
        }

        while (true) {
            try {
                FileChannel.open(lockPath, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { channel ->
                    val buffer = ByteBuffer.wrap((ConfigParser.mapper.writeValueAsString(lock) + "\n").toByteArray())
                    while (buffer.hasRemaining()) channel.write(buffer)
                    channel.force(true)
                }
                return token
            } catch (_: FileAlreadyExistsException) {
                if (removeKnownStaleLock(lockPath)) continue
                if (clock.millis() >= deadline) throw FileStoreException(localizer.message("config.locked"))
                try {
                    Thread.sleep(retryDelayMillis())
                } catch (interrupted: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw FileStoreException(localizer.message("config.lock.interrupted"), interrupted)
                }
            } catch (error: Throwable) {
                // CREATE_NEW 成功但写入失败时，不能把半截锁永久留在项目里。
                removeLockIfTokenMatches(lockPath, token)
                throw FileStoreException(localizer.message("config.lock.create.failed", error.message.orEmpty()), error)
            }
        }
    }

    private fun removeKnownStaleLock(lockPath: Path): Boolean {
        val lock = readLock(lockPath) ?: return false
        val createdAt = lock.path("createdAt").takeIf { it.isIntegralNumber }?.longValue() ?: return false
        val pid = lock.path("pid").takeIf { it.isIntegralNumber }?.longValue() ?: return false
        val ownerHost = lock.path("hostname").takeIf { it.isTextual }?.textValue() ?: return false
        val token = lock.path("token").takeIf { it.isTextual }?.textValue() ?: return false
        if (clock.millis() - createdAt < staleLockMillis || ownerHost != hostname || isProcessAlive(pid)) return false

        // 删除前重新按 token 核对，避免竞态下误删刚创建的新锁。
        return removeLockIfTokenMatches(lockPath, token)
    }

    private fun removeLockIfTokenMatches(lockPath: Path, token: String): Boolean {
        val current = readLock(lockPath) ?: return false
        if (current.path("token").textValue() != token) return false
        return runCatching { Files.deleteIfExists(lockPath) }.getOrDefault(false)
    }

    private fun readLock(lockPath: Path): ObjectNode? = runCatching {
        ConfigParser.mapper.readTree(Files.readAllBytes(lockPath)) as? ObjectNode
    }.getOrNull()

    private fun readPermissions(path: Path): Set<PosixFilePermission>? {
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return null
        return runCatching { Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS) }.getOrNull()
    }

    private fun syncDirectoryBestEffort(directory: Path?) {
        if (directory == null) return
        runCatching {
            FileChannel.open(directory, StandardOpenOption.READ).use { it.force(true) }
        }
    }
}
