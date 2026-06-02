# Schaak Studio

Een eenvoudige browser-schaakapp met Stockfish.js.

## Features

- Speler vs Stockfish met instelbare Elo.
- Bot vs bot met aparte Elo-instellingen.
- Instelbare speelsnelheid.
- Evaluatiebar met Stockfish-analyse.
- Eindevaluatie bij schaakmat of remise.
- Zetgeluid en duidelijke SVG-schaakstukken.

## Gebruik

Start een lokale server in deze map en open de app in je browser:

```powershell
python -m http.server 4199 --bind 127.0.0.1
```

Open daarna:

```text
http://127.0.0.1:4199/
```

De app gebruikt gratis CDN-bronnen voor `chess.js`, `Stockfish.js` en de Wikimedia/Cburnett schaakstukken.
