# Dataset: predictive maintenance

**In use: generated.** `ml/predictive-maintenance/generate.py` writes `raw/predictive-maintenance/` (git-ignored).
- Source: our fleet sim plus an injected-fault physics layer (see that README).
- Licence: ours.
- Reproduce with `python generate.py --days 14 --seed 7`, which takes about 7 min on one core and writes about 20 MB gzipped.

## External sets (validation, not downloaded)
None of these streams our telemetry fields (`motorTempC[4]`, `vibration[3]`, `batteryTempC`,
`batteryVoltageV`, `moistureDetected`). Each one can check a single fault signature in the generator.

| Set | What it has | Checks | Why not pulled (2026-11-20) |
|---|---|---|---|
| [PADRE](https://github.com/AeroLabPUT/UAV_measurement_data), Puchalski et al., JINT 2024 | Real IMU and microphone data, propeller faults on 1 to 4 rotors, Bebop 2 and 3DR Solo | `prop_damage` vibration | 4.7 GB in total (Bebop 2 raw data alone is 234 MB). No licence file, so ask the authors before redistributing. |
| [NASA PCoE Li-ion aging](https://data.nasa.gov/dataset/li-ion-battery-aging-datasets) | 18650 cells cycled to end of life | `weak_cell` resistance growth and fade | The direct ZIP returned 403. These are lab cells, not a 12S pack in flight. |
| [DronePropA](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12136912/), Data in Brief 2025 | 130 quadcopter flights with damaged props (.mat) | `prop_damage` | Prop faults only |
| [UAV-FD](https://zenodo.org/records/7648996), Zenodo 2023 | Hexarotor with a chipped blade, motor speeds | `prop_damage` | Prop faults only, and a hexarotor |
| U-Tokyo indoor UAV, [PHM AP 2025](https://www.papers.phmsociety.org/index.php/phmap/article/view/4701) | Motor RPM, ESC and motor temperatures | Motor thermal model | The authors call v1 immature, and we found no repo link |

First to pull when there is disk space: the PADRE Bebop 2 `Raw_data` folder, to check the vibration ratios.
