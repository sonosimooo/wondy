# Wondy

Wondy è un'app desktop per Windows per organizzare progetti e attività in tabelle personalizzabili. I dati sono salvati localmente in un database SQLite e gli aggiornamenti dell'app non eliminano le tabelle dell'utente.

Le tabelle standard includono elemento, stato, priorità e scadenza. La modalità chiara è attiva per impostazione predefinita. Usa il pulsante con la luna/il sole nella barra superiore per passare alla modalità scura; la preferenza viene salvata sul dispositivo.

## Requisiti

- Windows 10 o successivo per l'installer.
- Node.js 22 o successivo per avviare, testare e creare l'app dal codice.

## Avvio dal codice

```powershell
npm ci
npm start
```

## Test e creazione dell'installer

```powershell
npm test
npm run dist
```

L'installer viene creato in `dist/Wondy-<versione>-Setup.exe`. Distribuire l'installer, non l'eseguibile estratto da `win-unpacked`.

## Pubblicazione e aggiornamenti

Il repository GitHub `sonosimooo/wondy` pubblica gli installer tramite GitHub Actions. Per ogni nuova versione:

1. Aggiornare `version` in `package.json` e la versione corrispondente in `package-lock.json` (per esempio con `npm version patch --no-git-tag-version`).
2. Eseguire i test e inviare le modifiche al branch predefinito.
3. Creare e inviare un tag uguale alla versione, per esempio `v0.0.2`.
4. Attendere il completamento del workflow **Pubblica Wondy per Windows** e verificare che la release contenga l'installer, `latest.yml` e il file `.blockmap`.

Il workflow crea l'installer NSIS e verifica/carica l'installer, `latest.yml` e il `.blockmap` necessari a `electron-updater`. Per ripubblicare una release si può avviare manualmente il workflow indicando il relativo tag. All'avvio, appena la finestra è pronta, l'app verifica le release e mostra un popup con le scelte **Aggiorna ora** e **Rimanda**; in seguito ricontrolla ogni quattro ore. Al termine del download l'utente può installare e riavviare o rimandare. I dati SQLite restano nella cartella dati dell'utente, separati dall'applicazione.

Il programma non è firmato digitalmente: Windows potrebbe mostrare un avviso SmartScreen. La firma del codice richiede un certificato di firma per Windows e può essere aggiunta in seguito.
