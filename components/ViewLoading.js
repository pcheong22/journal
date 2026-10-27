export default function ViewLoading({label='Loading this view',compact=false,overlay=false}){
 return <div className={`view-loading${compact?' compact':''}${overlay?' overlay':''}`} role="status" aria-live="polite">
  <span className="view-loading-kicker">{label}</span>
  <div className="view-loading-lines" aria-hidden="true"><i/><i/><i/></div>
 </div>
}
