import '../styles/globals.css'
import '../styles/ledger.css'
import JournalAccess from '../components/JournalAccess'
export default function App({ Component, pageProps }) {
  if(Component.publicDesignPreview)return <Component {...pageProps}/>
  return <JournalAccess><Component {...pageProps} /></JournalAccess>
}
