package expo.modules.lokyxtap

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Tap to pay between two Android phones, over Bluetooth Low Energy.
 *
 * The receiver holds a payment request (the same text a QR code would carry, such as `lokyx:lyx1...?amount=5`)
 * in a GATT server and advertises it at very low power, so only a phone almost touching it can see it at all.
 * The sender scans for that service, and only when the signal is strong enough (a few centimetres) connects,
 * reads the request once and disconnects. Only the request travels this way: no keys, no money. The sender's
 * wallet still shows who is being paid and asks for the slide and the fingerprint.
 */
class LokyxTapModule : Module() {
  private val SERVICE: UUID = UUID.fromString("5b6f6b79-7874-4000-a000-6c6f6b797800")
  private val REQUEST: UUID = UUID.fromString("5b6f6b79-7874-4000-a000-6c6f6b797801")

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val main = Handler(Looper.getMainLooper())

  private var request: ByteArray = ByteArray(0)
  private var server: BluetoothGattServer? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var scanCallback: ScanCallback? = null
  private var client: BluetoothGatt? = null
  private var connecting = false
  private val giveUp = Runnable { fail("timeout") }

  private fun adapter(): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun supported(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

  private fun granted(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
        .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

  private fun emit(name: String, key: String, value: String) {
    main.post { sendEvent(name, bundleOf(key to value)) }
  }
  private fun error(reason: String) = emit("onError", "reason", reason)
  private fun state(s: String) = emit("onState", "state", s)

  override fun definition() = ModuleDefinition {
    Name("LokyxTap")
    Events("onPayload", "onState", "onError")

    Function("isSupported") { supported() }
    Function("hasPermission") { granted() }
    Function("startBroadcast") { text: String -> startBroadcast(text) }
    Function("stopBroadcast") { stopBroadcast() }
    Function("startScan") { minRssi: Int -> startScan(minRssi) }
    Function("stopScan") { stopScan() }

    OnDestroy {
      stopBroadcast()
      stopScan()
    }
  }

  // ---------- the receiver: show a request to a phone that is almost touching ----------

  private val serverCallback = object : BluetoothGattServerCallback() {
    @SuppressLint("MissingPermission")
    override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
      val s = server ?: return
      if (characteristic.uuid != REQUEST) {
        s.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, offset, null)
        return
      }
      if (offset > request.size) {
        s.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
        return
      }
      s.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, request.copyOfRange(offset, request.size))
      if (offset == 0) state("read")
    }
  }

  @SuppressLint("MissingPermission")
  private fun startBroadcast(text: String) {
    stopBroadcast()
    if (!supported()) return error("unsupported")
    if (!granted()) return error("permission")
    val bt = adapter()
    if (bt == null || !bt.isEnabled) return error("off")
    val advertiser = bt.bluetoothLeAdvertiser ?: return error("unsupported")
    val bytes = text.toByteArray(Charsets.UTF_8)
    if (bytes.isEmpty() || bytes.size > 400) return error("payload")
    request = bytes

    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val gatt = manager.openGattServer(context, serverCallback) ?: return error("server")
    val service = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(
      BluetoothGattCharacteristic(REQUEST, BluetoothGattCharacteristic.PROPERTY_READ, BluetoothGattCharacteristic.PERMISSION_READ)
    )
    gatt.addService(service)
    server = gatt

    // lowest transmit power: a phone a few centimetres away hears it, one across the room does not
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_ULTRA_LOW)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .addServiceUuid(ParcelUuid(SERVICE))
      .build()
    val cb = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) = state("broadcasting")
      override fun onStartFailure(errorCode: Int) = error("advertise:$errorCode")
    }
    advertiseCallback = cb
    advertiser.startAdvertising(settings, data, cb)
  }

  @SuppressLint("MissingPermission")
  private fun stopBroadcast() {
    try {
      val cb = advertiseCallback
      if (cb != null && granted()) adapter()?.bluetoothLeAdvertiser?.stopAdvertising(cb)
    } catch (_: Exception) {
    }
    advertiseCallback = null
    try {
      server?.close()
    } catch (_: Exception) {
    }
    server = null
    request = ByteArray(0)
  }

  // ---------- the sender: find a request held very close, read it once ----------

  @SuppressLint("MissingPermission")
  private fun startScan(minRssi: Int) {
    stopScan()
    if (!supported()) return error("unsupported")
    if (!granted()) return error("permission")
    val bt = adapter()
    if (bt == null || !bt.isEnabled) return error("off")
    val scanner = bt.bluetoothLeScanner ?: return error("unsupported")
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build())
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        if (connecting || result.rssi < minRssi) return
        connecting = true
        state("near")
        try {
          scanner.stopScan(this)
        } catch (_: Exception) {
        }
        scanCallback = null
        connect(result.device)
      }

      override fun onScanFailed(errorCode: Int) = error("scan:$errorCode")
    }
    scanCallback = cb
    scanner.startScan(filters, settings, cb)
    state("scanning")
  }

  @SuppressLint("MissingPermission")
  private fun stopScan() {
    main.removeCallbacks(giveUp)
    try {
      val cb = scanCallback
      if (cb != null && granted()) adapter()?.bluetoothLeScanner?.stopScan(cb)
    } catch (_: Exception) {
    }
    scanCallback = null
    closeClient()
    connecting = false
  }

  @SuppressLint("MissingPermission")
  private fun closeClient() {
    try {
      client?.disconnect()
      client?.close()
    } catch (_: Exception) {
    }
    client = null
  }

  private fun fail(reason: String) {
    val was = connecting
    stopScan()
    if (was) error(reason)
  }

  private val clientCallback = object : BluetoothGattCallback() {
    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        if (!gatt.requestMtu(247)) gatt.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED && connecting) {
        fail("lost")
      }
    }

    @SuppressLint("MissingPermission")
    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      gatt.discoverServices()
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      val characteristic = gatt.getService(SERVICE)?.getCharacteristic(REQUEST)
      if (status != BluetoothGatt.GATT_SUCCESS || characteristic == null || !gatt.readCharacteristic(characteristic)) fail("service")
    }

    // Android 13 and newer call this one
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
      got(status, value)
    }

    // older Android calls this one
    @Deprecated("Used on Android 12 and older")
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      @Suppress("DEPRECATION")
      got(status, characteristic.value ?: ByteArray(0))
    }
  }

  @SuppressLint("MissingPermission")
  private fun connect(device: BluetoothDevice) {
    main.postDelayed(giveUp, 7000)
    client = device.connectGatt(context, false, clientCallback, BluetoothDevice.TRANSPORT_LE)
  }

  private fun got(status: Int, value: ByteArray) {
    if (status != BluetoothGatt.GATT_SUCCESS || value.isEmpty()) return fail("read")
    val text = String(value, Charsets.UTF_8)
    main.post {
      stopScan()
      emit("onPayload", "payload", text)
    }
  }
}
