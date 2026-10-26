export default function CoachReportHeader({report,children}){
 return <>
  <div className={'coach-report-header'+(report?' has-score':'')}>
   <div className="coach-report-controls">{children}</div>
   {report&&<aside className="coach-score-summary" aria-label="Consistency score">
    <div><div className="coach-score-value">{report.score??'—'}<span>/100</span></div><div className="coach-score-label">Consistency score</div></div>
    {report.archetype&&<div className="coach-archetype">{report.archetype}</div>}
   </aside>}
  </div>
  {report?.score_rationale&&<section className="coach-assessment" aria-label="Score explanation"><h3>Score explanation</h3><p>{report.score_rationale}</p></section>}
 </>
}
