# JiuTianJiuDi (grid9)

Shell Flutter (WebView) del gioco: **tavola a 9 quadranti con slot 3x3 numerati 1-9**,
vassoio con 9 pedine colorate (x9 ciascuna) e **drag & drop libero — si può anche
sbagliare quadrante**. Al'avvio e col tasto indietro di Android si torna alla
**schermata iniziale** (PLAY / RESET). Il gioco è servito via HTTP locale
(`assets/www`) per evitare lo schermo nero del caricamento `file://`.

## Build APK release

```bash
cd ludo_grid
flutter pub get
flutter build apk --release --target-platform android-arm,android-arm64
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
