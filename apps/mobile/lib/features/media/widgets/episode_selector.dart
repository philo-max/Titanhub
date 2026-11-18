import 'package:flutter/material.dart';

import '../../../core/playback/chapter_groups.dart';
import '../../../core/theme/app_theme.dart';
import '../models/media_models.dart';

typedef EpisodeSelected = void Function(Chapter chapter, ChapterLine line);

class EpisodeSelector extends StatefulWidget {
  const EpisodeSelector({
    super.key,
    required this.lines,
    required this.onSelect,
    this.activeChapterId,
    this.activeGroupId,
  });

  final List<ChapterLine> lines;
  final EpisodeSelected onSelect;
  final String? activeChapterId;
  final String? activeGroupId;

  @override
  State<EpisodeSelector> createState() => _EpisodeSelectorState();
}

class _EpisodeSelectorState extends State<EpisodeSelector> {
  int _line = 0;
  int _page = 0;

  ChapterLocation? get _active =>
      locateChapter(widget.lines, widget.activeChapterId, groupId: widget.activeGroupId);

  @override
  void initState() {
    super.initState();
    _relocate();
  }

  @override
  void didUpdateWidget(covariant EpisodeSelector oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeChapterId != widget.activeChapterId ||
        oldWidget.activeGroupId != widget.activeGroupId ||
        !_sameShape(oldWidget.lines, widget.lines)) {
      _relocate();
    }
  }

  bool _sameShape(List<ChapterLine> a, List<ChapterLine> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].id != b[i].id || a[i].chapters.length != b[i].chapters.length) return false;
    }
    return true;
  }

  void _relocate() {
    final active = _active;
    if (active != null) {
      _line = active.line;
      _page = active.page;
      return;
    }
    final grouped = widget.lines.indexWhere((line) => line.id == widget.activeGroupId);
    _line = grouped >= 0 ? grouped : 0;
    _page = 0;
  }

  void _selectLine(int line) {
    final active = _active;
    final activeChapter =
        active == null ? null : widget.lines[active.line].chapters[active.index];
    setState(() {
      _page = selectLinePage(widget.lines, line, _page, activeChapter);
      _line = line;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.lines.isEmpty) return const SizedBox.shrink();
    final line = widget.lines[_line];
    final ranges = pageRanges(line.chapters.length);
    final range = ranges[_page.clamp(0, ranges.length - 1)];
    final active = _active;
    final activeIndex = active != null && active.line == _line ? active.index : -1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.lines.length > 1)
          _ChipRow(
            labels: [
              for (var i = 0; i < widget.lines.length; i++)
                '${lineDisplayName(widget.lines, i)} (${widget.lines[i].chapters.length})',
            ],
            selected: _line,
            onSelected: _selectLine,
          ),
        if (ranges.length > 1)
          _ChipRow(
            labels: [for (final page in ranges) pageLabel(line.chapters, page)],
            selected: _page,
            onSelected: (page) => setState(() => _page = page),
          ),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: MediaQuery.sizeOf(context).width < 380 ? 2 : 3,
            childAspectRatio: 2.6,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
          ),
          itemCount: range.end - range.start,
          itemBuilder: (context, offset) {
            final index = range.start + offset;
            final chapter = line.chapters[index];
            return _EpisodeTile(
              label: episodeLabel(chapter),
              active: index == activeIndex,
              onTap: () => widget.onSelect(chapter, line),
            );
          },
        ),
      ],
    );
  }
}

class _ChipRow extends StatelessWidget {
  const _ChipRow({required this.labels, required this.selected, required this.onSelected});

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (var i = 0; i < labels.length; i++)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(labels[i], style: const TextStyle(fontSize: 12)),
                  selected: i == selected,
                  selectedColor: AppTheme.primary.withOpacity(0.3),
                  backgroundColor: AppTheme.surface,
                  side: const BorderSide(color: AppTheme.surfaceLight),
                  onSelected: (_) => onSelected(i),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EpisodeTile extends StatelessWidget {
  const _EpisodeTile({required this.label, required this.active, required this.onTap});

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? AppTheme.primary.withOpacity(0.25) : AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: active ? AppTheme.primary : AppTheme.surfaceLight),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: active ? Colors.white : AppTheme.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
