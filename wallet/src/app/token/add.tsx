import { Redirect } from 'expo-router';

/** Old address of the token screen; it now lives in one place. */
export default function AddLyxToken() {
  return <Redirect href="/add-token?chain=lyx" />;
}
