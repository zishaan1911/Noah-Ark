import 'package:ark_contracts/ark_contracts.dart';
import 'package:flutter/material.dart';

import '../generated/l10n/app_localizations.dart';
import '../services/sos_controller.dart';
import '../widgets/tab_body.dart';

/// People and Needs: the optional form. Filled before the SOS, it goes with it; after, "Send details" updates it.
class PeopleTab extends StatefulWidget {
  const PeopleTab({super.key, required this.sos});
  final SosController sos;

  @override
  State<PeopleTab> createState() => _PeopleTabState();
}

class _PeopleTabState extends State<PeopleTab> {
  late final _phone = TextEditingController(text: widget.sos.phone);

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final sos = widget.sos;
    final labels = {
      Vulnerable.children: l.children,
      Vulnerable.elderly: l.elderly,
      Vulnerable.disabled: l.disabled,
      Vulnerable.pregnant: l.pregnant,
    };
    return TabBody(
      builder: (_) => [
        Text(l.peopleTitle, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        CounterRow(
          label: l.peopleTotal,
          value: sos.people,
          min: 1,
          fewer: l.fewer,
          more: l.more,
          onChanged: (n) => sos.edit(() => sos.people = n),
        ),
        const Divider(height: 1),
        for (final MapEntry(key: group, value: label) in labels.entries)
          CounterRow(
            label: label,
            value: sos.vulnerable[group]!,
            max: sos.people,
            fewer: l.fewer,
            more: l.more,
            onChanged: (n) => sos.edit(() => sos.vulnerable[group] = n),
          ),
        const SizedBox(height: 8),
        TextField(
          controller: _phone,
          keyboardType: TextInputType.phone,
          onChanged: (v) => sos.edit(() => sos.phone = v),
          decoration: InputDecoration(
            labelText: l.phoneLabel,
            hintText: '+60123456789',
            errorText: sos.phoneValid ? null : l.phoneInvalid,
            border: const OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const Spacer(),
        DetailsButton(sos: sos),
      ],
    );
  }
}

class NeedsTab extends StatefulWidget {
  const NeedsTab({super.key, required this.sos});
  final SosController sos;

  @override
  State<NeedsTab> createState() => _NeedsTabState();
}

class _NeedsTabState extends State<NeedsTab> {
  late final _medicines = TextEditingController(text: widget.sos.medicines);
  late final _notes = TextEditingController(text: widget.sos.notes);

  @override
  void dispose() {
    _medicines.dispose();
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final sos = widget.sos;
    final labels = {
      Need.WATER: l.needWater,
      Need.FOOD: l.needFood,
      Need.MEDICINE: l.needMedicine,
      Need.BABY_SUPPLIES: l.needBabySupplies,
      Need.SHELTER: l.needShelter,
      Need.RESCUE: l.needRescue,
      Need.OTHER: l.needOther,
    };
    return TabBody(
      builder: (_) => [
        Text(l.needsTitle, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final MapEntry(key: need, value: label) in labels.entries)
              FilterChip(
                visualDensity: VisualDensity.compact,
                label: Text(label),
                selected: sos.needs.contains(need),
                onSelected: (on) => sos.edit(() => on ? sos.needs.add(need) : sos.needs.remove(need)),
              ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _medicines,
          onChanged: (v) => sos.edit(() => sos.medicines = v),
          decoration: InputDecoration(
            labelText: l.medicinesLabel,
            hintText: l.medicinesHint,
            border: const OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _notes,
          maxLength: 4000,
          onChanged: (v) => sos.edit(() => sos.notes = v),
          decoration: InputDecoration(
            labelText: l.notesLabel,
            hintText: l.notesHint,
            border: const OutlineInputBorder(),
            isDense: true,
            counterText: '',
          ),
        ),
        const Spacer(),
        DetailsButton(sos: sos),
      ],
    );
  }
}

/// Before the SOS: says the details will go with it. After: sends them, or shows they are sent.
class DetailsButton extends StatelessWidget {
  const DetailsButton({super.key, required this.sos});
  final SosController sos;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    if (sos.sosId == null) {
      return Text(l.detailsWithSos, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium);
    }
    final canSend = sos.detailsDirty && sos.phoneValid && sos.progress == null && !sos.finished;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (sos.failure == Failure.sendFailed)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(l.sendFailed, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        FilledButton.icon(
          onPressed: canSend ? sos.sendDetails : null,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          icon: Icon(sos.detailsDirty ? Icons.send : Icons.check),
          label: Text(sos.detailsDirty ? l.sendDetails : l.detailsSent),
        ),
      ],
    );
  }
}
