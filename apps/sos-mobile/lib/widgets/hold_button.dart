import 'package:flutter/material.dart';

/// A big round button that fires only after being held for [hold], so a pocket press does not send an SOS.
/// Letting go early runs the ring back. Screen readers get a long-press action instead.
class HoldButton extends StatefulWidget {
  const HoldButton({
    super.key,
    required this.size,
    required this.label,
    required this.holdingLabel,
    required this.semanticsLabel,
    required this.onHeld,
    this.hold = const Duration(seconds: 2),
  });
  final double size;
  final String label;
  final String holdingLabel;
  final String semanticsLabel;
  final VoidCallback? onHeld;
  final Duration hold;

  @override
  State<HoldButton> createState() => _HoldButtonState();
}

class _HoldButtonState extends State<HoldButton> with SingleTickerProviderStateMixin {
  late final AnimationController _ring;

  @override
  void initState() {
    super.initState();
    _ring = AnimationController(vsync: this, duration: widget.hold)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          _ring.reset();
          widget.onHeld?.call();
        }
      });
  }

  @override
  void dispose() {
    _ring.dispose();
    super.dispose();
  }

  void _release() {
    if (_ring.isAnimating) _ring.reverse();
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onHeld != null;
    final red = enabled ? const Color(0xFFD32F2F) : Colors.grey;
    return Semantics(
      button: true,
      label: widget.semanticsLabel,
      onLongPress: widget.onHeld,
      excludeSemantics: true,
      child: Listener(
        onPointerDown: enabled ? (_) => _ring.forward() : null,
        onPointerUp: (_) => _release(),
        onPointerCancel: (_) => _release(),
        child: SizedBox.square(
          dimension: widget.size,
          child: AnimatedBuilder(
            animation: _ring,
            builder: (context, _) => Stack(
              fit: StackFit.expand,
              children: [
                CircularProgressIndicator(
                  value: _ring.value,
                  strokeWidth: 12,
                  color: red.withValues(alpha: 0.5),
                  backgroundColor: red.withValues(alpha: 0.12),
                ),
                Padding(
                  padding: const EdgeInsets.all(18),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: red,
                      shape: BoxShape.circle,
                      boxShadow: const [BoxShadow(blurRadius: 16, color: Colors.black26, offset: Offset(0, 6))],
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          widget.label,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: widget.size * 0.22,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        if (_ring.value > 0)
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: Text(
                              widget.holdingLabel,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.white, fontSize: 14),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
