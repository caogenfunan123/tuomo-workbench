#include "my_application.h"

#include <flutter_linux/flutter_linux.h>
#include <cstring>
#include <vector>
#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#endif

#include "flutter/generated_plugin_registrant.h"

struct _MyApplication {
  GtkApplication parent_instance;
  char** dart_entrypoint_arguments;
  GtkWindow* window;
  FlView* view;
  FlMethodChannel* platform_channel;
  GtkStatusIcon* tray_icon;
};

G_DEFINE_TYPE(MyApplication, my_application, GTK_TYPE_APPLICATION)

struct PlatformDialogRequest {
  FlMethodCall* method_call;
  bool save;
  bool image;
  std::vector<uint8_t> bytes;
};

static void platform_dialog_response_cb(GtkNativeDialog* native_dialog,
                                        gint response_id,
                                        gpointer user_data) {
  PlatformDialogRequest* request =
      static_cast<PlatformDialogRequest*>(user_data);
  g_autoptr(FlMethodResponse) response = nullptr;
  if (response_id != GTK_RESPONSE_ACCEPT) {
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else {
    gchar* filename = gtk_file_chooser_get_filename(
        GTK_FILE_CHOOSER(native_dialog));
    if (filename == nullptr) {
      response = FL_METHOD_RESPONSE(fl_method_error_response_new(
          "file_error", "No file was selected", nullptr));
    } else if (request->save) {
      g_autoptr(GError) write_error = nullptr;
      if (g_file_set_contents(
              filename,
              reinterpret_cast<const gchar*>(request->bytes.data()),
              static_cast<gssize>(request->bytes.size()), &write_error)) {
        g_autoptr(FlValue) value = fl_value_new_string(filename);
        response = FL_METHOD_RESPONSE(fl_method_success_response_new(value));
      } else {
        response = FL_METHOD_RESPONSE(fl_method_error_response_new(
            "save_failed", write_error != nullptr ? write_error->message
                                                   : "Unable to write file",
            nullptr));
      }
    } else {
      g_autofree gchar* contents = nullptr;
      gsize length = 0;
      g_autoptr(GError) read_error = nullptr;
      if (!g_file_get_contents(filename, &contents, &length, &read_error)) {
        response = FL_METHOD_RESPONSE(fl_method_error_response_new(
            "pick_failed",
            read_error != nullptr ? read_error->message : "Unable to read selected source",
            nullptr));
      } else {
        g_autoptr(FlValue) value = fl_value_new_map();
        g_autofree gchar* name = g_path_get_basename(filename);
        fl_value_set_string_take(value, "name", fl_value_new_string(name));
        fl_value_set_string_take(
            value, "bytes",
            fl_value_new_uint8_list(reinterpret_cast<const uint8_t*>(contents), length));
        fl_value_set_string_take(value, "path", fl_value_new_string(filename));
        response = FL_METHOD_RESPONSE(fl_method_success_response_new(value));
      }
    }
    g_free(filename);
  }
  g_autoptr(GError) error = nullptr;
  if (!fl_method_call_respond(request->method_call, response, &error)) {
    g_warning("Failed to respond to file dialog: %s", error->message);
  }
  g_object_unref(request->method_call);
  delete request;
  gtk_native_dialog_destroy(native_dialog);
  g_object_unref(native_dialog);
}

static void show_file_dialog(MyApplication* self, FlMethodCall* method_call,
                             bool save, bool image) {
  PlatformDialogRequest* request = new PlatformDialogRequest{
      static_cast<FlMethodCall*>(g_object_ref(method_call)), save, image, {}};
  if (save) {
    FlValue* arguments = fl_method_call_get_args(method_call);
    FlValue* bytes = arguments != nullptr
        ? fl_value_lookup_string(arguments, "bytes")
        : nullptr;
    if (bytes != nullptr && fl_value_get_type(bytes) == FL_VALUE_TYPE_UINT8_LIST) {
      const uint8_t* data = fl_value_get_uint8_list(bytes);
      request->bytes.assign(data, data + fl_value_get_length(bytes));
    }
  }
  GtkFileChooserAction action = save ? GTK_FILE_CHOOSER_ACTION_SAVE
                                     : GTK_FILE_CHOOSER_ACTION_OPEN;
  GtkFileChooserNative* dialog = gtk_file_chooser_native_new(
      save ? "保存 Markdown" : (image ? "打开图片" : "打开 Markdown"), self->window, action,
      save ? "保存" : "打开", "取消");
  GtkFileFilter* filter = gtk_file_filter_new();
  gtk_file_filter_set_name(filter, image ? "图片" : "Markdown");
  if (image) {
    gtk_file_filter_add_pattern(filter, "*.png");
    gtk_file_filter_add_pattern(filter, "*.jpg");
    gtk_file_filter_add_pattern(filter, "*.jpeg");
    gtk_file_filter_add_pattern(filter, "*.gif");
    gtk_file_filter_add_pattern(filter, "*.webp");
    gtk_file_filter_add_pattern(filter, "*.heic");
  } else {
    gtk_file_filter_add_pattern(filter, "*.md");
    gtk_file_filter_add_pattern(filter, "*.markdown");
  }
  gtk_file_chooser_add_filter(GTK_FILE_CHOOSER(dialog), filter);
  if (save) {
    FlValue* arguments = fl_method_call_get_args(method_call);
    FlValue* name = arguments != nullptr
        ? fl_value_lookup_string(arguments, "suggestedName")
        : nullptr;
    if (name != nullptr && fl_value_get_type(name) == FL_VALUE_TYPE_STRING) {
      gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dialog),
                                        fl_value_get_string(name));
    }
  }
  g_signal_connect(dialog, "response", G_CALLBACK(platform_dialog_response_cb),
                   request);
  gtk_native_dialog_show(GTK_NATIVE_DIALOG(dialog));
}

static void platform_method_call_cb(FlMethodChannel* channel,
                                    FlMethodCall* method_call,
                                    gpointer user_data) {
  MyApplication* self = static_cast<MyApplication*>(user_data);
  const gchar* method = fl_method_call_get_name(method_call);
  g_autoptr(FlMethodResponse) response = nullptr;
  g_autoptr(FlValue) arguments = fl_method_call_get_args(method_call);
  if (g_strcmp0(method, "setWindowTitle") == 0) {
    FlValue* title = arguments != nullptr ? fl_value_lookup_string(arguments, "title") : nullptr;
    if (title != nullptr && fl_value_get_type(title) == FL_VALUE_TYPE_STRING) {
      gtk_window_set_title(self->window, fl_value_get_string(title));
    }
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (g_strcmp0(method, "setWindowSize") == 0) {
    gint width = 1280;
    gint height = 720;
    if (arguments != nullptr) {
      FlValue* width_value = fl_value_lookup_string(arguments, "width");
      FlValue* height_value = fl_value_lookup_string(arguments, "height");
      if (width_value != nullptr) {
        width = fl_value_get_type(width_value) == FL_VALUE_TYPE_INT
            ? static_cast<gint>(fl_value_get_int(width_value))
            : static_cast<gint>(fl_value_get_float(width_value));
      }
      if (height_value != nullptr) {
        height = fl_value_get_type(height_value) == FL_VALUE_TYPE_INT
            ? static_cast<gint>(fl_value_get_int(height_value))
            : static_cast<gint>(fl_value_get_float(height_value));
      }
    }
    gtk_window_set_default_size(self->window, width, height);
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (g_strcmp0(method, "openQuickNote") == 0) {
    gtk_window_present(self->window);
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (g_strcmp0(method, "recordRecentFile") == 0) {
    FlValue* path = arguments != nullptr
        ? fl_value_lookup_string(arguments, "path")
        : nullptr;
    if (path != nullptr && fl_value_get_type(path) == FL_VALUE_TYPE_STRING) {
      g_autofree gchar* uri =
          g_filename_to_uri(fl_value_get_string(path), nullptr, nullptr);
      if (uri != nullptr) {
        gtk_recent_manager_add_item(gtk_recent_manager_get_default(), uri);
      }
    }
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (g_strcmp0(method, "platformEventsReady") == 0) {
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (g_strcmp0(method, "showPreview") == 0) {
    const gchar* markdown = "";
    FlValue* value = arguments != nullptr
        ? fl_value_lookup_string(arguments, "markdown")
        : nullptr;
    if (value != nullptr && fl_value_get_type(value) == FL_VALUE_TYPE_STRING) {
      markdown = fl_value_get_string(value);
    }
    GtkWidget* dialog = gtk_message_dialog_new(
        self->window, GTK_DIALOG_MODAL, GTK_MESSAGE_INFO, GTK_BUTTONS_CLOSE,
        "%s", markdown);
    gtk_window_set_title(GTK_WINDOW(dialog), "拓墨预览");
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
    response = FL_METHOD_RESPONSE(fl_method_success_response_new(nullptr));
  } else if (g_strcmp0(method, "pickMarkdown") == 0 ||
             g_strcmp0(method, "pickImage") == 0 ||
             g_strcmp0(method, "saveFile") == 0) {
    show_file_dialog(self, method_call, g_strcmp0(method, "saveFile") == 0,
                     g_strcmp0(method, "pickImage") == 0);
    return;
  } else {
    response = FL_METHOD_RESPONSE(fl_method_not_implemented_response_new());
  }
  g_autoptr(GError) error = nullptr;
  if (!fl_method_call_respond(method_call, response, &error)) {
    g_warning("Failed to respond to platform method: %s", error->message);
  }
}

static void create_platform_channel(MyApplication* self) {
  FlEngine* engine = fl_view_get_engine(self->view);
  FlBinaryMessenger* messenger = fl_engine_get_binary_messenger(engine);
  g_autoptr(FlStandardMethodCodec) codec = fl_standard_method_codec_new();
  self->platform_channel = fl_method_channel_new(
      messenger, "tuomo/platform", FL_METHOD_CODEC(codec));
  fl_method_channel_set_method_call_handler(
      self->platform_channel, platform_method_call_cb, self, nullptr);
}

static void drag_data_received_cb(GtkWidget*, GdkDragContext* context, gint,
                                  gint, GtkSelectionData* data, guint, guint time,
                                  gpointer user_data) {
  MyApplication* self = MY_APPLICATION(user_data);
  gboolean accepted = FALSE;
  gchar** uris = gtk_selection_data_get_uris(data);
  if (uris != nullptr && uris[0] != nullptr && self->platform_channel != nullptr) {
    g_autofree gchar* filename = g_filename_from_uri(uris[0], nullptr, nullptr);
    g_autofree gchar* contents = nullptr;
    gsize length = 0;
    if (filename != nullptr && g_file_get_contents(filename, &contents, &length, nullptr)) {
      g_autoptr(FlValue) value = fl_value_new_map();
      g_autofree gchar* name = g_path_get_basename(filename);
      fl_value_set_string_take(value, "name", fl_value_new_string(name));
      fl_value_set_string_take(
          value, "bytes",
          fl_value_new_uint8_list(reinterpret_cast<const uint8_t*>(contents), length));
      fl_value_set_string_take(value, "path", fl_value_new_string(filename));
      fl_method_channel_invoke_method(self->platform_channel, "fileDropped", value,
                                      nullptr, nullptr, nullptr);
      accepted = TRUE;
    }
  }
  if (uris != nullptr) g_strfreev(uris);
  gtk_drag_finish(context, accepted, FALSE, time);
}

static void install_drop_target(MyApplication* self) {
  GtkTargetEntry targets[] = {
      {const_cast<gchar*>("text/uri-list"), 0, 0},
  };
  gtk_drag_dest_set(GTK_WIDGET(self->window), GTK_DEST_DEFAULT_ALL, targets, 1,
                    GDK_ACTION_COPY);
  g_signal_connect(self->window, "drag-data-received",
                   G_CALLBACK(drag_data_received_cb), self);
}

static void tray_activate_cb(GtkStatusIcon*, gpointer user_data) {
  MyApplication* self = MY_APPLICATION(user_data);
  if (self->window != nullptr) gtk_window_present(self->window);
}

static void install_tray_icon(MyApplication* self) {
  if (self->tray_icon != nullptr) return;
  self->tray_icon = gtk_status_icon_new_from_icon_name("accessories-text-editor");
  gtk_status_icon_set_tooltip_text(self->tray_icon, "拓墨");
  gtk_status_icon_set_visible(self->tray_icon, TRUE);
  g_signal_connect(self->tray_icon, "activate", G_CALLBACK(tray_activate_cb), self);
}

// Called when first Flutter frame received.
static void first_frame_cb(MyApplication* self, FlView* view) {
  gtk_widget_show(gtk_widget_get_toplevel(GTK_WIDGET(view)));
}

// Implements GApplication::activate.
static void my_application_activate(GApplication* application) {
  MyApplication* self = MY_APPLICATION(application);
  GtkWindow* window =
      GTK_WINDOW(gtk_application_window_new(GTK_APPLICATION(application)));
  self->window = window;
  install_tray_icon(self);

  // Use a header bar when running in GNOME as this is the common style used
  // by applications and is the setup most users will be using (e.g. Ubuntu
  // desktop).
  // If running on X and not using GNOME then just use a traditional title bar
  // in case the window manager does more exotic layout, e.g. tiling.
  // If running on Wayland assume the header bar will work (may need changing
  // if future cases occur).
  gboolean use_header_bar = TRUE;
#ifdef GDK_WINDOWING_X11
  GdkScreen* screen = gtk_window_get_screen(window);
  if (GDK_IS_X11_SCREEN(screen)) {
    const gchar* wm_name = gdk_x11_screen_get_window_manager_name(screen);
    if (g_strcmp0(wm_name, "GNOME Shell") != 0) {
      use_header_bar = FALSE;
    }
  }
#endif
  if (use_header_bar) {
    GtkHeaderBar* header_bar = GTK_HEADER_BAR(gtk_header_bar_new());
    gtk_widget_show(GTK_WIDGET(header_bar));
    gtk_header_bar_set_title(header_bar, "tuomo_workbench");
    gtk_header_bar_set_show_close_button(header_bar, TRUE);
    gtk_window_set_titlebar(window, GTK_WIDGET(header_bar));
  } else {
    gtk_window_set_title(window, "tuomo_workbench");
  }

  gtk_window_set_default_size(window, 1280, 720);

  g_autoptr(FlDartProject) project = fl_dart_project_new();
  fl_dart_project_set_dart_entrypoint_arguments(
      project, self->dart_entrypoint_arguments);

  self->view = fl_view_new(project);
  FlView* view = self->view;
  GdkRGBA background_color;
  // Background defaults to black, override it here if necessary, e.g. #00000000
  // for transparent.
  gdk_rgba_parse(&background_color, "#000000");
  fl_view_set_background_color(view, &background_color);
  gtk_widget_show(GTK_WIDGET(view));
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));

  // Show the window when Flutter renders.
  // Requires the view to be realized so we can start rendering.
  g_signal_connect_swapped(view, "first-frame", G_CALLBACK(first_frame_cb),
                           self);
  gtk_widget_realize(GTK_WIDGET(view));

  fl_register_plugins(FL_PLUGIN_REGISTRY(view));
  create_platform_channel(self);
  install_drop_target(self);

  gtk_widget_grab_focus(GTK_WIDGET(view));
}

// Implements GApplication::local_command_line.
static gboolean my_application_local_command_line(GApplication* application,
                                                  gchar*** arguments,
                                                  int* exit_status) {
  MyApplication* self = MY_APPLICATION(application);
  // Strip out the first argument as it is the binary name.
  self->dart_entrypoint_arguments = g_strdupv(*arguments + 1);

  g_autoptr(GError) error = nullptr;
  if (!g_application_register(application, nullptr, &error)) {
    g_warning("Failed to register: %s", error->message);
    *exit_status = 1;
    return TRUE;
  }

  g_application_activate(application);
  *exit_status = 0;

  return TRUE;
}

// Implements GApplication::startup.
static void my_application_startup(GApplication* application) {
  // MyApplication* self = MY_APPLICATION(object);

  // Perform any actions required at application startup.

  G_APPLICATION_CLASS(my_application_parent_class)->startup(application);
}

// Implements GApplication::shutdown.
static void my_application_shutdown(GApplication* application) {
  // MyApplication* self = MY_APPLICATION(object);

  // Perform any actions required at application shutdown.

  G_APPLICATION_CLASS(my_application_parent_class)->shutdown(application);
}

// Implements GObject::dispose.
static void my_application_dispose(GObject* object) {
  MyApplication* self = MY_APPLICATION(object);
  g_clear_pointer(&self->dart_entrypoint_arguments, g_strfreev);
  g_clear_object(&self->platform_channel);
  g_clear_object(&self->view);
  g_clear_object(&self->tray_icon);
  self->window = nullptr;
  G_OBJECT_CLASS(my_application_parent_class)->dispose(object);
}

static void my_application_class_init(MyApplicationClass* klass) {
  G_APPLICATION_CLASS(klass)->activate = my_application_activate;
  G_APPLICATION_CLASS(klass)->local_command_line =
      my_application_local_command_line;
  G_APPLICATION_CLASS(klass)->startup = my_application_startup;
  G_APPLICATION_CLASS(klass)->shutdown = my_application_shutdown;
  G_OBJECT_CLASS(klass)->dispose = my_application_dispose;
}

static void my_application_init(MyApplication* self) {}

MyApplication* my_application_new() {
  // Set the program name to the application ID, which helps various systems
  // like GTK and desktop environments map this running application to its
  // corresponding .desktop file. This ensures better integration by allowing
  // the application to be recognized beyond its binary name.
  g_set_prgname(APPLICATION_ID);

  return MY_APPLICATION(g_object_new(my_application_get_type(),
                                     "application-id", APPLICATION_ID, "flags",
                                     G_APPLICATION_NON_UNIQUE, nullptr));
}
