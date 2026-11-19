/** The words on the Tap to pay screen. Kept here so what is promised is written once and can be checked. */
export const TAP_STEPS: { title: string; text: string }[] = [
  { title: 'Receiver turns on Tap', text: 'Open Receive with tap, and pick the coin.' },
  { title: 'Hold the tops together', text: 'Top edge to top edge, about 5 cm apart.' },
  { title: 'Sender checks and slides', text: 'The address and amount show first. Nothing moves until you slide.' },
];

export const TAP_HELP: { title: string; text: string }[] = [
  { title: 'Bluetooth is off', text: 'Turn it on in Quick settings, then try again.' },
  { title: 'Nearby devices is blocked', text: 'Settings, Apps, LOKYX, Permissions, allow Nearby devices.' },
  { title: 'Hold the tops together', text: 'Top edge to top edge, about 5 cm. A thick case can get in the way.' },
  { title: 'Both phones need Android 12 or newer', text: 'And the LOKYX wallet open. iPhones cannot tap yet.' },
];

export const TAP_SHARED = 'The other phone gets an address and an amount. Never your keys or words, and nothing moves until you slide.';
