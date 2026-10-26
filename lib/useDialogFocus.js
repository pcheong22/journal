import {useEffect,useRef} from 'react'
export function useDialogFocus(ref,onClose){
 const closeRef=useRef(onClose);closeRef.current=onClose
 useEffect(()=>{
  const panel=ref.current;if(!panel)return
  const previous=document.activeElement,overflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  const controls=()=>[...panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length)
  ;(panel.querySelector('[data-dialog-close]')||panel).focus()
  const keydown=e=>{
   if(e.key==='Escape'){e.preventDefault();closeRef.current();return}
   if(e.key!=='Tab')return
   const items=controls(),first=items[0],last=items.at(-1)
   if(!first){e.preventDefault();panel.focus();return}
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel)){e.preventDefault();last.focus()}
   else if(!e.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){e.preventDefault();first.focus()}
  }
  panel.addEventListener('keydown',keydown)
  return()=>{panel.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus?.()}
 },[ref])
}
