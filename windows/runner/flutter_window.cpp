#include "flutter_window.h"

#include <optional>
#include <fstream>
#include <cwctype>
#include <shellapi.h>
#include <string>
#include <vector>

#include "flutter/generated_plugin_registrant.h"
#include "resource.h"

namespace {

constexpr UINT kTrayMessage = WM_APP + 1;
constexpr UINT kTrayOpen = 41001;
constexpr UINT kTrayExit = 41002;

std::wstring ToWide(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
  if (size <= 1) return {};
  std::wstring result(size, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, result.data(), size);
  result.pop_back();
  return result;
}

std::string ToUtf8(const std::wstring& value) {
  if (value.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0,
                                       nullptr, nullptr);
  if (size <= 1) return {};
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, result.data(), size,
                      nullptr, nullptr);
  result.pop_back();
  return result;
}

bool ReadBytes(const std::wstring& path, std::vector<uint8_t>* bytes) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input) return false;
  const std::streamsize size = input.tellg();
  if (size < 0) return false;
  bytes->resize(static_cast<size_t>(size));
  input.seekg(0, std::ios::beg);
  return size == 0 || input.read(reinterpret_cast<char*>(bytes->data()), size);
}

bool GetDialogString(const flutter::EncodableMap* arguments, const char* key,
                     std::string* value) {
  if (arguments == nullptr) return false;
  const auto found = arguments->find(flutter::EncodableValue(key));
  if (found == arguments->end()) return false;
  const auto* text = std::get_if<std::string>(&found->second);
  if (text == nullptr) return false;
  *value = *text;
  return true;
}

bool IsDroppedDocument(const std::wstring& path) {
  const size_t separator = path.find_last_of(L"\\/");
  const size_t dot = path.find_last_of(L'.');
  if (dot == std::wstring::npos || (separator != std::wstring::npos && dot < separator)) {
    return false;
  }
  std::wstring extension = path.substr(dot);
  for (wchar_t& character : extension) character = towlower(character);
  return extension == L".md" || extension == L".markdown" || extension == L".html" ||
         extension == L".htm" || extension == L".docx" || extension == L".txt";
}

}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

void FlutterWindow::AddTrayIcon() {
  NOTIFYICONDATAW data = {};
  data.cbSize = sizeof(data);
  data.hWnd = GetHandle();
  data.uID = IDI_APP_ICON;
  data.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
  data.uCallbackMessage = kTrayMessage;
  data.hIcon = LoadIconW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APP_ICON));
  wcsncpy_s(data.szTip, ARRAYSIZE(data.szTip), L"拓墨", _TRUNCATE);
  tray_icon_added_ = Shell_NotifyIconW(NIM_ADD, &data) == TRUE;
}

void FlutterWindow::RemoveTrayIcon() {
  if (!tray_icon_added_) return;
  NOTIFYICONDATAW data = {};
  data.cbSize = sizeof(data);
  data.hWnd = GetHandle();
  data.uID = IDI_APP_ICON;
  Shell_NotifyIconW(NIM_DELETE, &data);
  tray_icon_added_ = false;
}

void FlutterWindow::ShowFromTray() {
  ShowWindow(GetHandle(), SW_SHOWNORMAL);
  SetForegroundWindow(GetHandle());
}

void FlutterWindow::HandleDroppedFiles(HDROP drop) {
  if (!platform_channel_) {
    DragFinish(drop);
    return;
  }
  const UINT count = DragQueryFileW(drop, 0xFFFFFFFF, nullptr, 0);
  if (count == 0) {
    DragFinish(drop);
    return;
  }
  wchar_t path[MAX_PATH] = {};
  if (DragQueryFileW(drop, 0, path, ARRAYSIZE(path)) == 0 ||
      !IsDroppedDocument(path)) {
    DragFinish(drop);
    return;
  }
  std::vector<uint8_t> bytes;
  if (ReadBytes(path, &bytes)) {
    flutter::EncodableMap picked;
    const std::wstring wide_path(path);
    const size_t separator = wide_path.find_last_of(L"\\/");
    const std::wstring name = separator == std::wstring::npos
                                  ? wide_path
                                  : wide_path.substr(separator + 1);
    picked[flutter::EncodableValue("name")] =
        flutter::EncodableValue(ToUtf8(name));
    picked[flutter::EncodableValue("bytes")] = flutter::EncodableValue(bytes);
    picked[flutter::EncodableValue("path")] =
        flutter::EncodableValue(ToUtf8(wide_path));
    platform_channel_->InvokeMethod(
        "fileDropped",
        std::make_unique<flutter::EncodableValue>(flutter::EncodableValue(picked)));
  }
  DragFinish(drop);
}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  platform_channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      flutter_controller_->engine()->messenger(), "tuomo/platform",
      &flutter::StandardMethodCodec::GetInstance());
  platform_channel_->SetMethodCallHandler(
      [this](const flutter::MethodCall<flutter::EncodableValue>& call,
             std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
        if (call.method_name() == "setWindowTitle") {
          const auto* arguments = std::get_if<flutter::EncodableMap>(call.arguments());
          if (arguments != nullptr) {
            const auto found = arguments->find(flutter::EncodableValue("title"));
            if (found != arguments->end()) {
              if (const auto* title = std::get_if<std::string>(&found->second)) {
                const std::wstring wide_title(title->begin(), title->end());
                SetWindowTextW(GetHandle(), wide_title.c_str());
              }
            }
          }
          result->Success();
          return;
        }
        if (call.method_name() == "setWindowSize") {
          const auto* arguments = std::get_if<flutter::EncodableMap>(call.arguments());
          double width = 1280;
          double height = 720;
          if (arguments != nullptr) {
            const auto read_number = [arguments](const char* key, double fallback) {
              const auto found = arguments->find(flutter::EncodableValue(key));
              if (found == arguments->end()) return fallback;
              if (const auto* value = std::get_if<double>(&found->second)) return *value;
              if (const auto* value = std::get_if<int32_t>(&found->second)) return static_cast<double>(*value);
              if (const auto* value = std::get_if<int64_t>(&found->second)) return static_cast<double>(*value);
              return fallback;
            };
            width = read_number("width", width);
            height = read_number("height", height);
          }
          SetWindowPos(GetHandle(), nullptr, 0, 0, static_cast<int>(width),
                       static_cast<int>(height), SWP_NOMOVE | SWP_NOZORDER);
          result->Success();
          return;
        }
        if (call.method_name() == "openQuickNote") {
          ShowWindow(GetHandle(), SW_SHOWNORMAL);
          SetForegroundWindow(GetHandle());
          result->Success();
          return;
        }
        if (call.method_name() == "recordRecentFile") {
          const auto* arguments =
              std::get_if<flutter::EncodableMap>(call.arguments());
          std::string path;
          if (GetDialogString(arguments, "path", &path) && !path.empty()) {
            const std::wstring wide_path = ToWide(path);
            SHAddToRecentDocs(SHARD_PATHW, wide_path.c_str());
          }
          result->Success();
          return;
        }
        if (call.method_name() == "platformEventsReady") {
          result->Success();
          return;
        }
        if (call.method_name() == "showPreview") {
          std::string markdown;
          const auto* arguments = std::get_if<flutter::EncodableMap>(call.arguments());
          GetDialogString(arguments, "markdown", &markdown);
          const std::wstring message = ToWide(markdown);
          MessageBoxW(GetHandle(), message.c_str(), L"拓墨预览", MB_OK | MB_ICONINFORMATION);
          result->Success();
          return;
        }
        if (call.method_name() == "pickMarkdown") {
          wchar_t path[MAX_PATH] = {};
          OPENFILENAMEW dialog = {};
          dialog.lStructSize = sizeof(dialog);
          dialog.hwndOwner = GetHandle();
          dialog.lpstrFilter = L"Documents (*.md;*.markdown;*.html;*.htm;*.docx)\0*.md;*.markdown;*.html;*.htm;*.docx\0All files\0*.*\0";
          dialog.lpstrFile = path;
          dialog.nMaxFile = ARRAYSIZE(path);
          dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
          if (GetOpenFileNameW(&dialog)) {
            std::vector<uint8_t> bytes;
            if (!ReadBytes(path, &bytes)) {
              result->Error("pick_failed", "Unable to read selected source");
              return;
            }
            const size_t separator = std::wstring(path).find_last_of(L"\\/");
            const std::wstring name = separator == std::wstring::npos
                                          ? std::wstring(path)
                                          : std::wstring(path).substr(separator + 1);
            flutter::EncodableMap picked;
            picked[flutter::EncodableValue("name")] =
                flutter::EncodableValue(ToUtf8(name));
            picked[flutter::EncodableValue("bytes")] =
                flutter::EncodableValue(bytes);
            picked[flutter::EncodableValue("path")] =
                flutter::EncodableValue(ToUtf8(std::wstring(path)));
            result->Success(flutter::EncodableValue(picked));
          } else {
            result->Success(flutter::EncodableValue());
          }
          return;
        }
        if (call.method_name() == "pickImage") {
          wchar_t path[MAX_PATH] = {};
          OPENFILENAMEW dialog = {};
          dialog.lStructSize = sizeof(dialog);
          dialog.hwndOwner = GetHandle();
          dialog.lpstrFilter = L"Images (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.heic)\0*.png;*.jpg;*.jpeg;*.gif;*.webp;*.heic\0All files\0*.*\0";
          dialog.lpstrFile = path;
          dialog.nMaxFile = ARRAYSIZE(path);
          dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
          if (GetOpenFileNameW(&dialog)) {
            std::vector<uint8_t> bytes;
            if (!ReadBytes(path, &bytes)) {
              result->Error("pick_failed", "Unable to read selected image");
              return;
            }
            const size_t separator = std::wstring(path).find_last_of(L"\\/");
            const std::wstring name = separator == std::wstring::npos
                                          ? std::wstring(path)
                                          : std::wstring(path).substr(separator + 1);
            flutter::EncodableMap picked;
            picked[flutter::EncodableValue("name")] =
                flutter::EncodableValue(ToUtf8(name));
            picked[flutter::EncodableValue("bytes")] =
                flutter::EncodableValue(bytes);
            picked[flutter::EncodableValue("path")] =
                flutter::EncodableValue(ToUtf8(std::wstring(path)));
            result->Success(flutter::EncodableValue(picked));
          } else {
            result->Success(flutter::EncodableValue());
          }
          return;
        }
        if (call.method_name() == "saveFile") {
          const auto* arguments = std::get_if<flutter::EncodableMap>(call.arguments());
          std::string suggested_name = "untitled.md";
          GetDialogString(arguments, "suggestedName", &suggested_name);
          wchar_t path[MAX_PATH] = {};
          const std::wstring wide_name = ToWide(suggested_name);
          wcsncpy_s(path, ARRAYSIZE(path), wide_name.c_str(), _TRUNCATE);
          OPENFILENAMEW dialog = {};
          dialog.lStructSize = sizeof(dialog);
          dialog.hwndOwner = GetHandle();
          dialog.lpstrFilter = L"Markdown (*.md)\0*.md\0All files\0*.*\0";
          dialog.lpstrFile = path;
          dialog.nMaxFile = ARRAYSIZE(path);
          dialog.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST;
          if (!GetSaveFileNameW(&dialog)) {
            result->Success(flutter::EncodableValue());
            return;
          }
          std::vector<uint8_t> bytes;
          if (arguments != nullptr) {
            const auto found = arguments->find(flutter::EncodableValue("bytes"));
            if (found != arguments->end()) {
              if (const auto* encoded = std::get_if<std::vector<uint8_t>>(&found->second)) {
                bytes = *encoded;
              }
            }
          }
          HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                    FILE_ATTRIBUTE_NORMAL, nullptr);
          if (file == INVALID_HANDLE_VALUE) {
            result->Error("save_failed", "Unable to open selected destination");
            return;
          }
          DWORD written = 0;
          const BOOL ok = bytes.empty() || WriteFile(file, bytes.data(),
                                                      static_cast<DWORD>(bytes.size()),
                                                      &written, nullptr);
          CloseHandle(file);
          if (!ok || written != bytes.size()) {
            result->Error("save_failed", "Unable to write selected destination");
          } else {
            result->Success(flutter::EncodableValue(ToUtf8(path)));
          }
          return;
        }
        result->NotImplemented();
      });
  SetChildContent(flutter_controller_->view()->GetNativeWindow());
  DragAcceptFiles(GetHandle(), TRUE);
  AddTrayIcon();

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  DragAcceptFiles(GetHandle(), FALSE);
  RemoveTrayIcon();
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_DROPFILES:
      HandleDroppedFiles(reinterpret_cast<HDROP>(wparam));
      return 0;
    case kTrayMessage:
      if (lparam == WM_LBUTTONUP || lparam == WM_LBUTTONDBLCLK) {
        ShowFromTray();
        return 0;
      }
      if (lparam == WM_RBUTTONUP) {
        POINT point = {};
        GetCursorPos(&point);
        SetForegroundWindow(hwnd);
        HMENU menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, kTrayOpen, L"打开拓墨");
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(menu, MF_STRING, kTrayExit, L"退出拓墨");
        const UINT command = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY,
                                            point.x, point.y, 0, hwnd, nullptr);
        DestroyMenu(menu);
        if (command == kTrayOpen) ShowFromTray();
        if (command == kTrayExit) PostMessageW(hwnd, WM_CLOSE, 0, 0);
        return 0;
      }
      break;
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
