import 'package:flutter/material.dart';

import '../generated/l10n/app_localizations.dart';
import '../services/sos_controller.dart';
import 'details_tabs.dart';
import 'sos_tab.dart';
import 'supplies_tab.dart';

/// Languages offered, each named in its own script.
const languages = {'en': 'English', 'ms': 'Bahasa Melayu', 'zh': '中文', 'ta': 'தமிழ்'};

/// Four tabs, each one screen: SOS (the button, then status), People, Needs, Supplies.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.sos, required this.onLanguage});
  final SosController sos;
  final ValueChanged<String> onLanguage;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  var _tab = 0;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.appTitle),
        actions: [
          PopupMenuButton<String>(
            tooltip: l.language,
            icon: const Icon(Icons.translate),
            onSelected: widget.onLanguage,
            itemBuilder: (_) => [
              for (final MapEntry(key: tag, value: name) in languages.entries)
                PopupMenuItem(value: tag, child: Text(name)),
            ],
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: widget.sos,
        builder: (context, _) => IndexedStack(
          index: _tab,
          children: [
            SosTab(sos: widget.sos),
            PeopleTab(sos: widget.sos),
            NeedsTab(sos: widget.sos),
            SuppliesTab(sos: widget.sos),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.sos), label: l.tabSos),
          NavigationDestination(icon: const Icon(Icons.groups), label: l.tabPeople),
          NavigationDestination(icon: const Icon(Icons.medical_services), label: l.tabNeeds),
          NavigationDestination(icon: const Icon(Icons.inventory_2), label: l.tabSupplies),
        ],
      ),
    );
  }
}
