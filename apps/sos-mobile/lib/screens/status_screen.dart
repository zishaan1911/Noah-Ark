import 'dart:async';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:flutter/material.dart';

import '../services/location.dart';
import '../services/sos_api.dart';

/// After the SOS is sent: polls its status and shares the sender's location until help is delivered.
class StatusScreen extends StatefulWidget {
  const StatusScreen({
    super.key,
    required this.sosId,
    required this.api,
    required this.locator,
    required this.onDone,
    this.pollEvery = const Duration(seconds: 10),
  });
  final String sosId;
  final SosApi api;
  final Locator locator;
  final VoidCallback onDone;
  final Duration pollEvery;

  @override
  State<StatusScreen> createState() => _StatusScreenState();
}

class _StatusScreenState extends State<StatusScreen> {
  SosRequest? _sos;
  Timer? _poll;
  StreamSubscription<Geo>? _sharing;
  String? _sharingError;

  bool get _finished => _sos?.status == SosStatus.DELIVERED || _sos?.status == SosStatus.CLOSED;

  @override
  void initState() {
    super.initState();
    _refresh();
    _poll = Timer.periodic(widget.pollEvery, (_) => _refresh());
    _sharing = widget.locator.track().listen(
      _sendLocation,
      onError: (Object e) => setState(() => _sharingError = '$e'),
    );
  }

  Future<void> _refresh() async {
    try {
      final sos = await widget.api.get(widget.sosId);
      if (!mounted) return;
      setState(() => _sos = sos);
      if (_finished) _stop();
    } catch (_) {
      // No signal: keep the last status and try again on the next tick.
    }
  }

  Future<void> _sendLocation(Geo location) async {
    try {
      // UTC so the timestamp carries a zone, as the schema's date-time needs.
      final keepGoing = await widget.api.sendLocation(
        widget.sosId,
        SosLocationUpdate(location: location, ts: DateTime.now().toUtc()),
      );
      if (!keepGoing) _stop();
    } catch (_) {
      // A missed update is fine: the next fix replaces it.
    }
  }

  void _stop() {
    _poll?.cancel();
    _sharing?.cancel();
    _sharing = null;
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sos = _sos;
    final status = sos?.status;
    final delivery = sos?.delivery;
    final eta = delivery?.etaMinutes;
    final steps = [
      (done: true, title: 'SOS sent', detail: 'We have your request and location.'),
      (
        done: status != null && status != SosStatus.NEW,
        title: 'Help is being arranged',
        detail: 'A coordinator is choosing what to send.',
      ),
      (
        done: delivery != null,
        title: delivery == null ? 'Drone on the way' : 'Drone ${delivery.droneId} on the way',
        detail: eta == null
            ? 'Stay where you are if it is safe.'
            : 'About ${eta.round()} min. Stay where you are if it is safe.',
      ),
      (done: _finished, title: 'Delivered', detail: 'Take the supplies from the drone.'),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Ark SOS')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(_finished ? 'Help has arrived' : 'Help is coming', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          for (final step in steps)
            ListTile(
              leading: Icon(
                step.done ? Icons.check_circle : Icons.radio_button_unchecked,
                color: step.done ? Theme.of(context).colorScheme.primary : null,
              ),
              title: Text(step.title),
              subtitle: Text(step.detail),
            ),
          const Divider(height: 32),
          if (!_finished)
            ListTile(
              leading: Icon(_sharingError == null ? Icons.my_location : Icons.location_disabled),
              title: Text(_sharingError == null ? 'Sharing your location' : 'Location not shared'),
              subtitle: Text(_sharingError ?? 'Keep this phone with you. Sharing stops when help arrives.'),
            ),
          if (_finished)
            FilledButton(
              onPressed: widget.onDone,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              child: const Text('Done'),
            ),
          const SizedBox(height: 8),
          Text('Reference: ${widget.sosId}', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}
