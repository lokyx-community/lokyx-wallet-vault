import { Redirect } from 'expo-router';

/** Old address of the token screen; it now lives in one place. */
export default function AddEthToken() {
  return <Redirect href="/add-token?chain=eth" />;
}
