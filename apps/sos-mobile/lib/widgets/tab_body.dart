import 'package:flutter/material.dart';

/// A tab's content. Designed to fit a phone screen without scrolling (tests check 360 x 640 in every language);
/// the scroll view only matters when the keyboard is open.
class TabBody extends StatelessWidget {
  const TabBody({super.key, required this.builder});
  final List<Widget> Function(BoxConstraints space) builder;

  static const padding = 16.0;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => CustomScrollView(
      slivers: [
        // Fills the tab so Spacers work; scrolls only if the content really does not fit.
        SliverFillRemaining(
          hasScrollBody: false,
          child: Padding(
            padding: const EdgeInsets.all(padding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: builder(constraints.deflate(const EdgeInsets.all(padding))),
            ),
          ),
        ),
      ],
    ),
  );
}

/// "Label  [-] n [+]" on one row.
class CounterRow extends StatelessWidget {
  const CounterRow({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    required this.fewer,
    required this.more,
    this.min = 0,
    this.max = 99,
  });
  final String label;
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;
  final String fewer;
  final String more;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(label, style: Theme.of(context).textTheme.titleMedium)),
      IconButton.outlined(
        visualDensity: VisualDensity.compact,
        tooltip: '$fewer: $label',
        onPressed: value > min ? () => onChanged(value - 1) : null,
        icon: const Icon(Icons.remove),
      ),
      SizedBox(
        width: 40,
        child: Text('$value', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
      ),
      IconButton.outlined(
        visualDensity: VisualDensity.compact,
        tooltip: '$more: $label',
        onPressed: value < max ? () => onChanged(value + 1) : null,
        icon: const Icon(Icons.add),
      ),
    ],
  );
}
