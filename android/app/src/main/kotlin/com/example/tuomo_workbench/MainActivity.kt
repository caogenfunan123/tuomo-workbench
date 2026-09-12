package com.example.tuomo_workbench

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.view.Gravity
import android.widget.ScrollView
import android.widget.TextView
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    companion object {
        const val ACTION_OPEN_QUICK_NOTE = "com.example.tuomo_workbench.OPEN_QUICK_NOTE"
        const val REQUEST_PICK = 4101
        const val REQUEST_SAVE = 4102
        const val REQUEST_IMAGE = 4103
    }

    private lateinit var channel: MethodChannel
    private var pendingResult: MethodChannel.Result? = null
    private var pendingBytes: ByteArray? = null
    private var pendingQuickNote = false
    private var platformEventsReady = false

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_OPEN_QUICK_NOTE) {
            moveTaskToFrontIfNeeded()
            notifyQuickNoteRequested()
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "tuomo/platform")
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "pickMarkdown" -> openPicker(result, "*/*", REQUEST_PICK)
                "pickImage" -> openPicker(result, "image/*", REQUEST_IMAGE)
                "saveFile" -> openSaveDialog(call, result)
                "setWindowTitle" -> {
                    title = call.argument<String>("title") ?: title
                    result.success(null)
                }
                "setWindowSize" -> result.success(null)
                "openQuickNote" -> {
                    moveTaskToFrontIfNeeded()
                    result.success(null)
                }
                "recordRecentFile" -> result.success(null)
                "showPreview" -> showPreview(call.argument<String>("markdown") ?: "", result)
                "platformEventsReady" -> {
                    platformEventsReady = true
                    result.success(null)
                    if (pendingQuickNote) {
                        pendingQuickNote = false
                        notifyQuickNoteRequested()
                    }
                }
                else -> result.notImplemented()
            }
        }
        if (intent.action == ACTION_OPEN_QUICK_NOTE) {
            notifyQuickNoteRequested()
        }
    }

    private fun notifyQuickNoteRequested() {
        if (::channel.isInitialized && platformEventsReady) {
            channel.invokeMethod("quickNoteRequested", null)
        } else {
            pendingQuickNote = true
        }
    }

    private fun moveTaskToFrontIfNeeded() {
        if (!isFinishing) {
            window.decorView.post { window.decorView.requestFocus() }
        }
    }

    private fun showPreview(markdown: String, result: MethodChannel.Result) {
        val text = TextView(this).apply {
            setTextColor(Color.BLACK)
            textSize = 16f
            gravity = Gravity.START
            setPadding(32, 24, 32, 24)
            text = markdown
        }
        val scroll = ScrollView(this).apply { addView(text) }
        AlertDialog.Builder(this)
            .setTitle("拓墨预览")
            .setView(scroll)
            .setPositiveButton("关闭", null)
            .show()
        result.success(null)
    }

    private fun openPicker(result: MethodChannel.Result, mimeType: String, requestCode: Int) {
        if (pendingResult != null) {
            result.error("busy", "Another file operation is already active", null)
            return
        }
        pendingResult = result
        try {
            startActivityForResult(
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mimeType
                }, requestCode
            )
        } catch (error: Exception) {
            pendingResult = null
            result.error("picker_unavailable", error.message, null)
        }
    }

    private fun openSaveDialog(call: io.flutter.plugin.common.MethodCall, result: MethodChannel.Result) {
        if (pendingResult != null) {
            result.error("busy", "Another file operation is already active", null)
            return
        }
        pendingBytes = call.argument<ByteArray>("bytes") ?: ByteArray(0)
        pendingResult = result
        try {
            startActivityForResult(
                Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "text/markdown"
                    putExtra(Intent.EXTRA_TITLE, call.argument<String>("suggestedName") ?: "untitled.md")
                }, REQUEST_SAVE
            )
        } catch (error: Exception) {
            pendingBytes = null
            pendingResult = null
            result.error("save_unavailable", error.message, null)
        }
    }

    @Deprecated("Deprecated in Android API Activity, retained for Flutter runner compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val callback = pendingResult ?: return
        pendingResult = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            pendingBytes = null
            callback.success(null)
            return
        }
        if (requestCode == REQUEST_PICK || requestCode == REQUEST_IMAGE) {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Cannot open selected source")
                val name = contentResolver.query(uri, arrayOf("_display_name"), null, null, null)
                    ?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else null
                    } ?: uri.lastPathSegment ?: "untitled.md"
                callback.success(mapOf("name" to name, "bytes" to bytes, "path" to uri.toString()))
            } catch (error: Exception) {
                callback.error("pick_failed", error.message, null)
            }
            return
        }
        try {
            contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(pendingBytes ?: ByteArray(0))
            } ?: throw IllegalStateException("Cannot open selected destination")
            callback.success(uri.toString())
        } catch (error: Exception) {
            callback.error("save_failed", error.message, null)
        } finally {
            pendingBytes = null
        }
    }

    override fun onDestroy() {
        pendingResult?.error("cancelled", "Activity was destroyed", null)
        pendingResult = null
        pendingBytes = null
        super.onDestroy()
    }

}
