import {JournalWorkspace} from './index'
import {designSample} from '../lib/designSample'
const sample=designSample()
export default function DesignPreview(){return <JournalWorkspace previewData={sample}/>}
DesignPreview.publicDesignPreview=true
