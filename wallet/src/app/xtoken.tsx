import { Redirect, useLocalSearchParams } from 'expo-router';

/** Old address of the token screen; it now lives in one place. */
export default function AddXToken() {
  const { chain } = useLocalSearchParams<{ chain?: string }>();
  return <Redirect href={`/add-token?chain=${chain === 'trx' ? 'trx' : 'sol'}`} />;
}
