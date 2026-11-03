# Wondy

Wondy è un'app desktop per Windows per organizzare progetti e attività in tabelle personalizzabili. I dati sono salvati localmente in un database SQLite e gli aggiornamenti dell'app non eliminano le tabelle dell'utente.

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
4. Attendere il completamento del workflow **Pubblica Wondy per Windows** e verificare la release su GitHub.

Il workflow crea l'installer NSIS e i file `latest.yml` e `.blockmap` necessari a `electron-updater`. Le installazioni già esistenti verificano la release all'avvio e ogni quattro ore; prima di scaricare viene chiesto il consenso. Al termine del download l'utente può installare e riavviare o rimandare. I dati SQLite restano nella cartella dati dell'utente, separati dall'applicazione.

Il programma non è firmato digitalmente: Windows potrebbe mostrare un avviso SmartScreen. La firma del codice richiede un certificato di firma per Windows e può essere aggiunta in seguito.
