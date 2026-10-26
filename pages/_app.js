import '../styles/globals.css'
import JournalAccess from '../components/JournalAccess'
export default function App({ Component, pageProps }) {
  return <JournalAccess><Component {...pageProps} /></JournalAccess>
}
