export default function JournalLoading({error='',onRetry}){
 return <main className="journal-loading" aria-busy={!error}>
  <div className="journal-loading-brand"><span className="brand-mark" aria-hidden="true">j.</span>Journal</div>
  <section className="loading-message" role={error?'alert':'status'}>
   <h1>{error?'Your journal could not load':'Opening your journal'}</h1>
   <p>{error||'Loading your accounts and closed trades. Your saved records stay private.'}</p>
   {error&&<button className="btn btn-p" onClick={onRetry}>Retry loading</button>}
  </section>
  {!error&&<div className="loading-layout" aria-hidden="true"><div className="loading-metrics">{[0,1,2,3].map(n=><div key={n}><span/><strong/><span/></div>)}</div><div className="loading-chart"/></div>}
 </main>
}
