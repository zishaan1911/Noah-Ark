import 'dart:ui';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:flutter/material.dart';

import '../services/location.dart';
import '../services/sos_api.dart';

const needLabels = {
  Need.WATER: 'Water',
  Need.FOOD: 'Food',
  Need.MEDICINE: 'Medicine',
  Need.BABY_SUPPLIES: 'Baby supplies',
  Need.SHELTER: 'Shelter',
  Need.RESCUE: 'Rescue',
  Need.OTHER: 'Other',
};

/// Same rule as the schema's contactPhone pattern (E.164).
final e164 = RegExp(r'^\+[1-9][0-9]{6,14}$');

class HelpScreen extends StatefulWidget {
  const HelpScreen({super.key, required this.api, required this.locator, required this.onSent});
  final SosApi api;
  final Locator locator;
  final void Function(String sosId) onSent;

  @override
  State<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends State<HelpScreen> {
  final _form = GlobalKey<FormState>();
  final _message = TextEditingController();
  final _phone = TextEditingController();
  final _needs = <Need>{};
  var _people = 1;
  String? _progress;
  String? _error;

  @override
  void dispose() {
    _message.dispose();
    _phone.dispose();
    super.dispose();
  }

  void _fail(String error) => setState(() {
    _progress = null;
    _error = error;
  });

  Future<void> _send() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _progress = 'Finding your location…';
      _error = null;
    });
    try {
      final location = await widget.locator.current();
      setState(() => _progress = 'Sending…');
      final sos = await widget.api.create(
        SosReport(
          channel: Channel.APP,
          location: location,
          language: PlatformDispatcher.instance.locale.toLanguageTag(),
          rawMessage: _message.text.trim().isEmpty ? null : _message.text.trim(),
          peopleCount: _people,
          needs: _needs.isEmpty ? null : _needs.toList(),
          contactPhone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
        ),
      );
      widget.onSent(sos.id);
    } on LocationUnavailable catch (e) {
      _fail(e.reason);
    } catch (_) {
      // shortcut: no offline queue or SMS fallback yet, add one once the SMS intake number exists
      _fail('Could not send. Check your signal and try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = _progress != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Ark SOS')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Ask for help', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 4),
            const Text('A drone brings food, water or medicine. Your location is sent with the request.'),
            const SizedBox(height: 16),
            TextFormField(
              controller: _message,
              enabled: !busy,
              maxLength: 4000,
              minLines: 3,
              maxLines: 6,
              decoration: const InputDecoration(
                labelText: 'What is happening?',
                hintText: 'Any language. E.g. "Flood, 4 of us on the roof, need insulin"',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            Text('What do you need?', style: Theme.of(context).textTheme.titleMedium),
            Wrap(
              spacing: 8,
              children: [
                for (final MapEntry(key: need, value: label) in needLabels.entries)
                  FilterChip(
                    label: Text(label),
                    selected: _needs.contains(need),
                    onSelected: busy ? null : (on) => setState(() => on ? _needs.add(need) : _needs.remove(need)),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: Text('People with you', style: Theme.of(context).textTheme.titleMedium)),
                IconButton.outlined(
                  tooltip: 'Fewer people',
                  onPressed: busy || _people == 1 ? null : () => setState(() => _people--),
                  icon: const Icon(Icons.remove),
                ),
                SizedBox(
                  width: 48,
                  child: Text('$_people', textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
                ),
                IconButton.outlined(
                  tooltip: 'More people',
                  onPressed: busy ? null : () => setState(() => _people++),
                  icon: const Icon(Icons.add),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _phone,
              enabled: !busy,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Phone (optional)',
                hintText: '+60123456789',
                border: OutlineInputBorder(),
              ),
              validator: (v) => v == null || v.trim().isEmpty || e164.hasMatch(v.trim())
                  ? null
                  : 'Use the international format, e.g. +60123456789',
            ),
            const SizedBox(height: 24),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            FilledButton.icon(
              onPressed: busy ? null : _send,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
              icon: busy
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.sos),
              label: Text(_progress ?? 'Send SOS'),
            ),
          ],
        ),
      ),
    );
  }
}
