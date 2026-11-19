import { useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Sheet } from './Sheet';
import { T } from './Text';
import { Qr } from './Qr';
import { Segmented } from './Segmented';
import { ProgressBar } from './ProgressBar';
import { Button, ErrorText, Field, success } from './controls';
import { toast } from './Toast';
import { C, F } from './theme';
import { BACKUP_MIME, MIN_PASSWORD, backupFileName, backupFileText, backupFromFile, backupKind, openBackup, sealBackup, type BackupKind } from '../lib/backup-seal';

const WHAT: Record<BackupKind, string> = { wallet: 'wallet', vault: 'vault recovery' };

/** Let the screen draw the spinner and bar before the heavy work starts, or the first seconds look frozen. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));

/** Progress as a number that only changes when the whole percent does, so the screen isn't redrawn hundreds of times. */
const steps = (set: (p: number) => void) => {
  let last = -1;
  return (p: number) => {
    const n = Math.floor(p * 100);
    if (n !== last) {
      last = n;
      set(n / 100);
    }
  };
};

/** Lock the words with a password and get them back as a QR code or a line of text: no 24 words to type later. */
export function SaveBackup({ open, onClose, secret, kind }: { open: boolean; onClose: () => void; secret: string; kind: BackupKind }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState('');
  const [out, setOut] = useState('');
  const [qr, setQr] = useState(false);
  const close = () => {
    setPw('');
    setPw2('');
    setOut('');
    setQr(false);
    setErr('');
    onClose();
  };
  /** Write the backup to a file and open the phone's share sheet: Files, Drive, email, WhatsApp, another phone. */
  const saveFile = async () => {
    try {
      const f = new File(Paths.cache, backupFileName(kind));
      if (f.exists) f.delete();
      f.create();
      f.write(backupFileText(out));
      if (!(await Sharing.isAvailableAsync())) return toast("This phone can't share files from here. Use Copy instead.", 'info');
      await Sharing.shareAsync(f.uri, { mimeType: BACKUP_MIME, dialogTitle: 'Save your LOKYX backup', UTI: 'public.plain-text' });
    } catch (e) {
      toast(`Could not make the file. ${(e as Error).message}`, 'info');
    }
  };
  const make = async () => {
    setErr('');
    if (pw.length < MIN_PASSWORD) return setErr(`Use at least ${MIN_PASSWORD} characters.`);
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setDone(0);
    setBusy(true);
    try {
      await paint();
      setOut(await sealBackup(secret, pw, kind, steps(setDone)));
      success();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={close}>
      <View style={{ gap: 14 }}>
        {!out ? (
          <>
            <T v="headline">Save an encrypted backup</T>
            <T v="sub" dim style={{ lineHeight: 20 }}>{`Your ${WHAT[kind]} words are locked with a password you choose, then saved as a file you can keep anywhere, or as a QR code or one line of text. To restore, choose the file (or scan or paste it) and type the password. Keep the password somewhere other than the backup.`}</T>
            <Field value={pw} onChangeText={setPw} placeholder="Backup password" secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <Field value={pw2} onChangeText={setPw2} placeholder="Type it again" secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <ErrorText>{err}</ErrorText>
            {busy ? (
              <>
                <ProgressBar value={done} label="Locking your backup" />
                <T v="caption" dim>This is slow on purpose, so guessing the password stays slow. It can take a while on an older phone. Keep the app open.</T>
              </>
            ) : null}
            <Button title={busy ? 'Locking…' : 'Make backup'} busy={busy} onPress={make} />
          </>
        ) : (
          <>
            <T v="headline">Your backup</T>
            <T v="sub" dim style={{ lineHeight: 20 }}>Save the file somewhere safe: your files, Google Drive, an email to yourself, or another phone. To get your wallet back, choose this file and type the password. Without the password it opens nothing, and if you forget the password it can't be recovered.</T>
            <Button title="Save as a file" onPress={saveFile} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Share text" kind="line" style={{ flex: 1 }} onPress={() => Share.share({ message: out }).catch(() => {})} />
              <Button title="Copy" kind="line" style={{ flex: 1 }} onPress={async () => { await Clipboard.setStringAsync(out); toast('Backup copied', 'copy'); }} />
            </View>
            <T v="caption" dim style={{ lineHeight: 18 }}>Screenshots are blocked on this screen on purpose. The QR code is on the next tap, for scanning from another phone.</T>
            {qr ? (
              <View style={{ alignItems: 'center' }}>
                <View style={{ borderRadius: 18, overflow: 'hidden' }}><Qr value={out} size={250} /></View>
              </View>
            ) : (
              <Button title="Show QR code" kind="plain" onPress={() => setQr(true)} />
            )}
            <Button title="Done" kind="plain" onPress={close} />
          </>
        )}
      </View>
    </Sheet>
  );
}

/** Scan or paste a backup, type its password, and hand the words back. */
export function OpenBackup({ open, onClose, kind, onSecret }: { open: boolean; onClose: () => void; kind: BackupKind; onSecret: (words: string) => void }) {
  const [mode, setMode] = useState<'file' | 'scan' | 'paste'>('file');
  const [perm, ask] = useCameraPermissions();
  const [text, setText] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const got = backupKind(text);
  const close = () => {
    setText('');
    setPw('');
    setErr('');
    onClose();
  };
  const pickFile = async () => {
    setErr('');
    try {
      const r = await File.pickFileAsync({ mimeTypes: ['*/*'] });
      if (r.canceled) return;
      setReading(true);
      const found = backupFromFile(await r.result.text());
      if (!found) return setErr("That file isn't a LOKYX backup. Choose the file you saved from the backup screen.");
      setText(found);
    } catch (e) {
      setErr(`Could not read that file. ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  };
  const go = async () => {
    setErr('');
    setDone(0);
    setBusy(true);
    try {
      await paint();
      const r = await openBackup(text, pw, steps(setDone));
      if (r.kind !== kind) throw new Error(kind === 'wallet' ? 'That is a vault recovery backup. Open it where the vault asks for its 12 words.' : 'That is a wallet backup. Use it when restoring the wallet.');
      success();
      onSecret(r.secret);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={close}>
      <View style={{ gap: 14 }}>
        <T v="headline">Use a backup</T>
        {!got ? (
          <>
            <Segmented<'file' | 'scan' | 'paste'> value={mode} onChange={setMode} options={[['file', 'File'], ['scan', 'Scan QR'], ['paste', 'Paste']]} />
            {mode === 'file' ? (
              <>
                <T v="sub" dim style={{ lineHeight: 20 }}>Choose the backup file you saved. It is called {backupFileName(kind)}, or similar.</T>
                <Button title={reading ? 'Reading…' : 'Choose backup file'} busy={reading} onPress={pickFile} />
              </>
            ) : mode === 'scan' ? (
              perm?.granted ? (
                <View style={{ height: 250, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000' }}>
                  <CameraView
                    style={{ flex: 1 }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={(e) => {
                      if (backupKind(e.data)) setText(e.data.trim());
                      else setErr("That QR code isn't a LOKYX backup.");
                    }}
                  />
                </View>
              ) : (
                <Button title="Allow camera to scan" kind="line" onPress={ask} />
              )
            ) : (
              <>
                <Field value={text} onChangeText={setText} placeholder="lokyx-backup:…" mono multiline autoCapitalize="none" autoCorrect={false} style={{ minHeight: 90 }} />
                <Button title="Paste" kind="line" onPress={async () => setText((await Clipboard.getStringAsync()).trim())} />
              </>
            )}
            {text.length > 12 && !got ? <T v="sub" color={C.soft}>That isn't a LOKYX backup. It starts with lokyx-backup:</T> : null}
          </>
        ) : (
          <>
            <T v="sub" dim>Backup found. Type the password you chose when you saved it.</T>
            <Field value={pw} onChangeText={setPw} placeholder="Backup password" secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus />
            <ErrorText>{err}</ErrorText>
            {busy ? (
              <>
                <ProgressBar value={done} label="Checking the password" />
                <T v="caption" dim>It can take a while on an older phone. Keep the app open.</T>
              </>
            ) : null}
            <Button title={busy ? 'Opening…' : 'Open backup'} busy={busy} disabled={pw.length < 1} onPress={go} />
            {busy ? null : <Button title="Use a different backup" kind="plain" onPress={() => { setText(''); setPw(''); setErr(''); }} />}
          </>
        )}
        {!got ? <ErrorText>{err}</ErrorText> : null}
      </View>
    </Sheet>
  );
}
