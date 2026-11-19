# JiuTianJiuDi (ludo_grid)

Shell Flutter (WebView) per il gioco ludo a griglia 9x9, con gioco servito via HTTP locale
(`assets/www`) per evitare lo schermo nero del caricamento `file://`.

## Build APK release

```bash
cd ludo_grid
flutter pub get
flutter build apk --release
```

Output: `ludo_grid/build/app/outputs/flutter-apk/app-release.apk`
(la firma di release usa la chiave debug, generata automaticamente dalla build).

## CI (GitHub Actions)

`.github/workflows/build-apk.yml` — build automatica:

- **push** sul branch `jiutianjiudi` (percorsi `ludo_grid/**` o del workflow stesso)
- **manuale**: tab *Actions* → *build-apk* → *Run workflow*

L'APK viene pubblicato come artifact `JiuTianJiuDi-release-apk` (conservazione 30 giorni).

## Note

- `ludo_grid/assets/www` contiene gli asset del gioco originale (© CrazyGames, Ludo Club),
  inclusi per uso personale.
