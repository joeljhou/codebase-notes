import org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    java
    kotlin("jvm") version "2.3.20"
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "com.codebasenotes"
version = providers.fileContents(layout.projectDirectory.file("../../VERSION"))
    .asText
    .map { it.trim() }
    .get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.22.0")

    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testImplementation("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.vintage:junit-vintage-engine:5.13.4")

    intellijPlatform {
        intellijIdea("2025.3.4")
        testFramework(TestFrameworkType.Platform)
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        // ProjectViewNodeDecorator still contains a deprecated default overload for binary compatibility.
        // Kotlin's default JVM mode emits a bridge to it in every implementation, which Marketplace flags
        // as deprecated API usage even though only the current ProjectViewNode overload is implemented.
        jvmDefault.set(JvmDefaultMode.NO_COMPATIBILITY)
    }
}

tasks.test {
    useJUnitPlatform()
    workingDir = rootDir
}

tasks.processResources {
    from(rootDir.resolve("../../spec/codebase-notes.schema.json"))
    from(rootDir.resolve("THIRD_PARTY_NOTICES.md"))
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "253"
        }
    }
}
