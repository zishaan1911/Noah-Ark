import 'dart:math';

import 'package:ark_contracts/ark_contracts.dart';
import 'package:flutter/material.dart';

import '../generated/l10n/app_localizations.dart';
import '../services/sos_controller.dart';
import '../widgets/hold_button.dart';
import '../widgets/tab_body.dart';

/// The first thing on screen: the big red button. Once sent, the same tab follows the SOS.
class SosTab extends StatelessWidget {
  const SosTab({super.key, required this.sos});
  final SosController sos;

  @override
  Widget build(BuildContext context) => sos.sosId == null ? _Button(sos: sos) : _Status(sos: sos);
}

class _Button extends StatelessWidget {
  const _Button({required this.sos});
  final SosController sos;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final message = switch ((sos.progress, sos.failure)) {
      (Progress.locating, _) => l.findingLocation,
      (Progress.sending, _) => l.sending,
      (_, Failure.locationOff) => l.locationOff,
      (_, Failure.locationDenied) => l.locationDenied,
      (_, Failure.sendFailed) => l.sendFailed,
      _ => l.holdToSend,
    };
    return TabBody(
      builder: (space) => [
        Text(l.sosHint, textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
        const Spacer(),
        Center(
          child: HoldButton(
            size: min(space.maxWidth * 0.8, space.maxHeight * 0.6),
            label: 'SOS',
            holdingLabel: l.keepHolding,
            semanticsLabel: l.holdToSend,
            onHeld: sos.progress == null ? sos.sendSos : null,
          ),
        ),
        const Spacer(),
        Text(
          message,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium?.copyWith(color: sos.failure != null ? theme.colorScheme.error : null),
        ),
      ],
    );
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.sos});
  final SosController sos;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final status = sos.sos?.status;
    final delivery = sos.sos?.delivery;
    final eta = delivery?.etaMinutes;
    final steps = [
      (done: true, title: l.stepSent, detail: l.stepSentDetail),
      (done: status != null && status != SosStatus.NEW, title: l.stepArranged, detail: l.stepArrangedDetail),
      (
        done: delivery != null,
        title: delivery == null ? l.stepDrone : l.stepDroneNamed(delivery.droneId),
        detail: eta == null ? l.stepDroneWait : l.stepDroneEta(eta.round()),
      ),
      (done: sos.finished, title: l.stepDelivered, detail: l.stepDeliveredDetail),
    ];
    // Only the latest step reached gets its detail line (e.g. the ETA), which keeps the tab on one screen.
    final current = steps.lastIndexWhere((s) => s.done);

    return TabBody(
      builder: (_) => [
        Text(sos.finished ? l.helpArrived : l.helpComing, style: theme.textTheme.titleLarge),
        const SizedBox(height: 8),
        for (final (i, step) in steps.indexed)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              step.done ? Icons.check_circle : Icons.radio_button_unchecked,
              color: step.done ? theme.colorScheme.primary : null,
            ),
            title: Text(step.title, style: theme.textTheme.titleMedium),
            visualDensity: VisualDensity.compact,
            subtitle: i == current ? Text(step.detail) : null,
          ),
        const Spacer(),
        if (!sos.finished)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(sos.sharing ? Icons.my_location : Icons.location_disabled),
            // The ongoing Android notification carries the longer explanation.
            title: Text(sos.sharing ? l.sharingOn : l.sharingOff),
          ),
        if (sos.finished)
          FilledButton(
            onPressed: sos.finish,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
            child: Text(l.done),
          ),
        const SizedBox(height: 8),
        Text(l.reference(sos.sosId!), style: theme.textTheme.bodySmall),
      ],
    );
  }
}
