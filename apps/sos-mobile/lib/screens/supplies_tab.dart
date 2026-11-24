import 'package:ark_contracts/ark_contracts.dart';
import 'package:flutter/material.dart';

import '../generated/l10n/app_localizations.dart';
import '../services/sos_controller.dart';
import '../widgets/tab_body.dart';

// shortcut: Ark-1's 2 kg payload cap (mission.schema.json payloadKg maximum) is repeated here for the gauge only,
// read it from the API if the fleet gets other drone sizes
const payloadCapKg = 2.0;

/// The kit mission-planner (Bedrock) packed for this SOS, as the operator will send it.
class SuppliesTab extends StatelessWidget {
  const SuppliesTab({super.key, required this.sos});
  final SosController sos;

  static String _kg(double kg) => kg.toStringAsFixed(2).replaceFirst(RegExp(r'0$'), '');

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final delivery = sos.sos?.delivery;
    final kit = delivery?.payload ?? const <PayloadItem>[];
    final kg = delivery?.payloadKg ?? kit.fold<double>(0, (sum, line) => sum + line.weightKg);
    final waiting = {MissionStatus.PENDING_APPROVAL, MissionStatus.APPROVED}.contains(delivery?.missionStatus);
    return TabBody(
      builder: (_) => [
        Text(l.suppliesTitle, style: theme.textTheme.titleLarge),
        const SizedBox(height: 8),
        if (kit.isEmpty) Text(l.suppliesEmpty, style: theme.textTheme.bodyLarge),
        if (waiting) Text(l.suppliesPending, style: theme.textTheme.bodyMedium),
        for (final line in kit)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
            leading: CircleAvatar(radius: 14, child: Text('${line.qty}', style: const TextStyle(fontSize: 12))),
            title: Text(line.item, maxLines: 2, overflow: TextOverflow.ellipsis),
            trailing: Text('${_kg(line.weightKg)} kg'),
          ),
        const Spacer(),
        if (kit.isNotEmpty) ...[
          LinearProgressIndicator(value: (kg / payloadCapKg).clamp(0, 1), minHeight: 10),
          const SizedBox(height: 6),
          Text(l.suppliesTotal(_kg(kg), _kg(payloadCapKg)), textAlign: TextAlign.end),
        ],
      ],
    );
  }
}
