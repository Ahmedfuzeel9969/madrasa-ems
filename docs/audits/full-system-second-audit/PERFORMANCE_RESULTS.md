# Large-Data اور Performance Results

## پانچ-run synthetic timings

تمام اوقات milliseconds میں ہیں۔

| Records | Metric | Min | Max | Average | Median | First run | Outlier |
|---:|---|---:|---:|---:|---:|---:|---|
| 100 | parse | 0.17 | 0.18 | 0.17 | 0.17 | 0.18 | کوئی نمایاں نہیں |
| 100 | search | 0.53 | 0.56 | 0.54 | 0.54 | 0.55 | کوئی نہیں |
| 1,000 | parse | 1.10 | 1.33 | 1.23 | 1.31 | 1.11 | 1.10 low |
| 1,000 | arrears map | 0.47 | 0.84 | 0.57 | 0.52 | 0.84 | first run |
| 1,000 | search | 1.08 | 1.36 | 1.15 | 1.10 | 1.36 | first run |
| 2,500 | parse | 2.97 | 4.02 | 3.24 | 3.02 | 2.97 | 4.02 high |
| 2,500 | search | 1.56 | 2.02 | 1.71 | 1.63 | 1.63 | 2.02 high |
| 10,000 | parse | 11.53 | 12.57 | 11.92 | 11.83 | 12.57 | first run |
| 10,000 | arrears map | 4.43 | 5.20 | 4.70 | 4.62 | 4.60 | 5.20 high |
| 10,000 | search | 5.96 | 8.46 | 6.64 | 6.19 | 6.19 | 8.46 high |
| 50,000 | parse | 59.48 | 62.18 | 60.89 | 61.08 | 62.18 | first run |
| 50,000 | arrears map | 21.91 | 26.52 | 23.08 | 22.20 | 26.52 | first run |
| 50,000 | search | 26.93 | 30.24 | 28.51 | 28.39 | 30.24 | first run |

## Real Chromium IndexedDB

| Records | Insert | Index total | Sort page | Filter | Search | Admission first page | Reload persistence |
|---:|---:|---:|---:|---:|---:|---:|---|
| 100 | 10.9ms | 16.1ms | 4.6ms | 3.8ms | 8.1ms | 5.3ms | PASS |
| 1,000 | 162.6ms | 277.9ms | 17.3ms | 16.0ms | 48.7ms | 22.4ms | PASS |
| 2,500 | 936.5ms | 1.394s | 29.2ms | 34.6ms | 70.9ms | 63.2ms | PASS |
| 10,000 | 10.988s | 17.673s | 98.9ms | 106.4ms | 248.2ms | 207.2ms | PASS |
| 50,000 | 195.488s | 353.507s | 556.9ms | 570.7ms | 1.337s | 1.152s | PASS |

## تشخیص

- Indexed pagination full collection load استعمال نہیں کرتی؛ trace checks PASS۔
- persistence correctness 50k تک ثابت ہوئی۔
- 50k initial insert/search-index build تقریباً 5.9 منٹ ہے؛ بڑے ادارے میں first migration/index rebuild operationally unacceptable ہو سکتا ہے۔
- 50k interactive search 1.3s اور first page 1.15s ہے؛ lower-end Android پر مزید سست ہونے کا امکان ہے۔
- benchmark صرف registrations-oriented repository ہے؛ related attendance/finance/exams/complaints/audit combined 50k workload نہیں چلا۔
- startup، authenticated login، Firebase push/pull cost، signed mobile اور packaged Windows پانچ-run measurements **UNVERIFIED**۔

## نتیجہ

2,500 records پر repository acceptable ہے۔ 10k قابلِ استعمال مگر index creation noticeable ہے۔ 50k کو production-ready کہنا درست نہیں جب تک background/resumable index build، progress UI، cancellation، mobile memory اور cloud-read benchmarks نہ ہوں۔
