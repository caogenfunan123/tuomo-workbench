import SwiftUI
import WidgetKit

struct QuickNoteEntry: TimelineEntry {
  let date: Date
}

struct QuickNoteProvider: TimelineProvider {
  func placeholder(in context: Context) -> QuickNoteEntry {
    QuickNoteEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (QuickNoteEntry) -> Void) {
    completion(QuickNoteEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickNoteEntry>) -> Void) {
    let entry = QuickNoteEntry(date: Date())
    completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
  }
}

struct QuickNoteWidgetView: View {
  var entry: QuickNoteProvider.Entry

  private var content: some View {
    Link(destination: URL(string: "tuomo://quick-note")!) {
      VStack(spacing: 8) {
        Image(systemName: "square.and.pencil")
          .font(.system(size: 28, weight: .semibold))
        Text("新建拓墨笔记")
          .font(.headline)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  @ViewBuilder
  var body: some View {
    if #available(iOSApplicationExtension 17.0, *) {
      content.containerBackground(.fill.tertiary, for: .widget)
    } else {
      content.padding()
    }
  }
}

@main
struct QuickNoteWidget: Widget {
  let kind = "QuickNoteWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: QuickNoteProvider()) { entry in
      QuickNoteWidgetView(entry: entry)
    }
    .configurationDisplayName("拓墨速记")
    .description("从主屏幕快速打开一篇新的拓墨笔记。")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
