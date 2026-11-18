import 'package:flutter/material.dart';

import '../../core/sources/unified/unified_models.dart';
import '../../core/theme/app_theme.dart';

BoxDecoration panelDecoration() => BoxDecoration(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(AppTheme.radius2XL),
    );

String originLabel(String origin) =>
    origin == 'snapshot' ? '内置快照（离线）' : Uri.tryParse(origin)?.host ?? origin;

class SourceNotice extends StatelessWidget {
  const SourceNotice(this.message, this.color, {super.key});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: Text(message, style: TextStyle(color: color, fontSize: 12)),
    );
  }
}

class SourceReportPanel extends StatelessWidget {
  const SourceReportPanel(this.report, {super.key});

  final UnifiedReport report;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('source-report'),
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('结果：${report.summary}',
              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
          if (report.origins.isNotEmpty)
            Text('目录来源：${report.origins.map(originLabel).toSet().join('、')}',
                style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
          for (final warning in report.warnings)
            Text(warning, style: const TextStyle(color: AppTheme.warning, fontSize: 11)),
          for (final note in report.notes)
            Text('${note.name}：${note.message}',
                style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
          for (final failure in report.failures)
            Text('${failure.name} 失败：${failure.message}',
                style: const TextStyle(color: AppTheme.danger, fontSize: 11)),
        ],
      ),
    );
  }
}

class SourceUrlPanel extends StatelessWidget {
  const SourceUrlPanel({
    super.key,
    required this.title,
    required this.description,
    required this.fieldKey,
    required this.controller,
    required this.hint,
    required this.actions,
    this.error,
  });

  final String title;
  final String description;
  final Key fieldKey;
  final TextEditingController controller;
  final String hint;
  final List<Widget> actions;
  final String? error;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(16),
      decoration: panelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
          const SizedBox(height: 4),
          Text(description, style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
          const SizedBox(height: 8),
          TextField(
            key: fieldKey,
            controller: controller,
            keyboardType: TextInputType.url,
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: InputDecoration(hintText: hint),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(error!, style: const TextStyle(color: AppTheme.danger, fontSize: 11)),
            ),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 4, children: actions),
        ],
      ),
    );
  }
}

String catalogDescription(String catalogUrl, int defaultMirrors) => catalogUrl.isEmpty
    ? '当前使用内置 $defaultMirrors 个镜像，依次回退。仅支持 HTTPS，目录下需有 index.json。'
    : '当前使用自定义目录：$catalogUrl';

class BusyRow extends StatelessWidget {
  const BusyRow(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
        const SizedBox(width: 8),
        Flexible(
          child: Text(message, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
        ),
      ],
    );
  }
}
