import './style.css'

interface SerialPortInfo { usbProductId?: number }
interface SerialPort {
  readable: ReadableStream<Uint8Array<ArrayBufferLike>> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}
interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>
  requestPort(): Promise<SerialPort>
}
declare global { interface Navigator { serial: Serial } }
const app = document.querySelector<HTMLDivElement>('#app')!
const serialSupported = 'serial' in navigator
let selectedPort: SerialPort | undefined
let reader: ReadableStreamDefaultReader<string> | undefined
let writer: WritableStreamDefaultWriter<Uint8Array> | undefined
let keepReading = false

app.innerHTML = `
  <main class="shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">~</span><span>Wireline</span></div><span class="protocol">WEB SERIAL <span class="dot"></span></span></header>
    <section class="intro"><p class="eyebrow">PORT CONSOLE / 01</p><h1>Talk to your<br><em>hardware.</em></h1><p class="lede">A quiet terminal for the noisy work.<br>Connect to a serial device and start listening.</p></section>
    <section class="workspace" aria-label="Console série">
      <div class="connection-bar"><div class="field-wrap"><label for="port-select">SERIAL PORT</label><select id="port-select" ${serialSupported ? '' : 'disabled'}><option value="">Select a port...</option></select></div><button id="connect-button" class="connect-button" type="button" ${serialSupported ? '' : 'disabled'}><span class="button-icon">↗</span> Open port</button></div>
      <div class="terminal-card"><div class="terminal-head"><div class="terminal-status"><span id="status-dot" class="status-dot"></span><span id="status-label">Disconnected</span></div><button id="clear-button" class="clear-button" type="button">Clear output</button></div><div id="output" class="output" role="log" aria-live="polite"><div class="welcome-line"><span class="prompt">›</span><span>Choose a serial port to begin.</span></div></div><form id="send-form" class="send-form"><label class="sr-only" for="input">Send characters</label><input id="input" type="text" placeholder="Type a message to send..." autocomplete="off" disabled><button type="submit" disabled>Send <span>↗</span></button></form></div>
    </section>
    <footer><span>NO DATA LEAVES YOUR BROWSER</span><span>BAUD RATE <strong>9600</strong></span></footer>
  </main>`

const portSelect = document.querySelector<HTMLSelectElement>('#port-select')!
const connectButton = document.querySelector<HTMLButtonElement>('#connect-button')!
const input = document.querySelector<HTMLInputElement>('#input')!
const sendForm = document.querySelector<HTMLFormElement>('#send-form')!
const output = document.querySelector<HTMLDivElement>('#output')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear-button')!
const statusDot = document.querySelector<HTMLSpanElement>('#status-dot')!
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')!

function addLine(text: string, kind = '') {
  const line = document.createElement('div')
  line.className = `output-line ${kind}`
  line.textContent = text
  output.append(line)
  output.scrollTop = output.scrollHeight
}

function setConnected(connected: boolean) {
  statusDot.classList.toggle('connected', connected)
  statusLabel.textContent = connected ? 'Connected' : 'Disconnected'
  connectButton.innerHTML = `<span class="button-icon">↗</span> ${connected ? 'Close port' : 'Open port'}`
  input.disabled = !connected
  sendForm.querySelector('button')!.disabled = !connected
  if (connected) input.focus()
}

async function refreshPorts() {
  if (!serialSupported) return
  const ports = await navigator.serial.getPorts()
  portSelect.innerHTML = '<option value="">Select a port...</option>'
  ports.forEach((port, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = port.getInfo().usbProductId ? `USB serial device ${index + 1}` : `Serial device ${index + 1}`
    portSelect.append(option)
  })
}

async function readLoop(port: SerialPort) {
  if (!port.readable) return
  const textDecoder = new TextDecoderStream()
  port.readable.pipeTo(textDecoder.writable as unknown as WritableStream<Uint8Array<ArrayBufferLike>>).catch(() => undefined)
  reader = textDecoder.readable.getReader()
  keepReading = true
  try {
    while (keepReading) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) addLine(value, 'received')
    }
  } catch (error) {
    addLine(`Read error: ${error instanceof Error ? error.message : 'unknown error'}`, 'error')
  } finally {
    reader.releaseLock()
    reader = undefined
  }
}

async function openPort() {
  try {
    if (selectedPort) {
      keepReading = false
      await reader?.cancel()
      writer?.releaseLock()
      await selectedPort.close()
      selectedPort = undefined
      setConnected(false)
      addLine('Port closed.', 'system')
      return
    }
    const ports = await navigator.serial.getPorts()
    selectedPort = ports[Number(portSelect.value)]
    if (!selectedPort) selectedPort = await navigator.serial.requestPort()
    await selectedPort.open({ baudRate: 9600 })
    writer = selectedPort.writable?.getWriter()
    setConnected(true)
    addLine('Port opened at 9600 baud.', 'system')
    void readLoop(selectedPort)
    await refreshPorts()
  } catch (error) {
    selectedPort = undefined
    setConnected(false)
    addLine(`Could not open port: ${error instanceof Error ? error.message : 'unknown error'}`, 'error')
  }
}

connectButton.addEventListener('click', openPort)
clearButton.addEventListener('click', () => { output.innerHTML = '' })
sendForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!writer || !input.value) return
  const message = input.value
  await writer.write(new TextEncoder().encode(`${message}\r\n`))
  addLine(message, 'sent')
  input.value = ''
})

if (!serialSupported) {
  portSelect.innerHTML = '<option>Web Serial unavailable</option>'
  addLine('Web Serial is unavailable in this browser. Use Chrome or Edge over HTTPS.', 'error')
} else {
  void refreshPorts()
  navigator.serial.addEventListener('connect', () => void refreshPorts())
  navigator.serial.addEventListener('disconnect', () => void refreshPorts())
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
