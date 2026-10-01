import { ArrowLeft, Ban, Check, Copy, Image as ImageIcon, MessageCircle, MoreVertical, Palette, Search, Send, Smile, Trash2, UserRound, X, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { apiRequest } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import { CipherAvatar } from '../components/CipherAvatar';

const EMOJIS = ['😀','😂','😍','🥹','😎','😭','😅','🤝','❤️','🔥','🎉','👏','🙏','💯','🤣','😘','🥰','😮','😢','😡','👍','👎','💙','✨','🚀','🫶','😈','🤔','🙌','💀'];
const BGS = ['#000000','#ffffff','#f6f7fb','#f4f1ff','#eef6ff','#f4f8f5','#fff8ef'];

type Person = { id:number; firstName:string; lastName:string; email:string; avatarUrl?:string|null; gender?:string|null; userCode?:string|null; chatPublicKey?:string|null };
type Message = { id:number; senderId:number; body?:string|null; imageUrl?:string|null; gifUrl?:string|null; createdAt:string };


function decodeChatMessage(m: any) {
  const body = String(m.body ?? '');
  if (body.startsWith('E2EE1.')) return { ...m, decrypted: { error: true, legacyEncrypted: true } };
  try {
    const parsed = JSON.parse(body);
    return { ...m, decrypted: parsed };
  } catch {
    return { ...m, decrypted: { text: body } };
  }
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve,reject) => { const r=new FileReader(); r.onload=()=>typeof r.result==='string'?resolve(r.result):reject(new Error('Could not read image.')); r.onerror=()=>reject(new Error('Could not read image.')); r.readAsDataURL(file); });
}

export default function ChatPage() {
  const [, params] = useRoute<{ id:string }>('/chat/:id');
  const [, setLocation] = useLocation();
  const [code,setCode]=useState('');
  const [found,setFound]=useState<Person|null>(null);
  const [chats,setChats]=useState<any[]>([]);
  const [chat,setChat]=useState<any>(null);
  const [chatLoading,setChatLoading]=useState(false);
  const [messages,setMessages]=useState<Message[]>([]);
  const [decrypted,setDecrypted]=useState<any[]>([]);
  const [other,setOther]=useState<Person|null>(null);
  const [currentUserId,setCurrentUserId]=useState<number|null>(null);
  const [replyTo,setReplyTo]=useState<any|null>(null);
  const swipeStartX=useRef<number|null>(null);
  const [swipeId,setSwipeId]=useState<number|null>(null);
  const [swipeOffset,setSwipeOffset]=useState(0);
  const [text,setText]=useState('');
  const [error,setError]=useState('');
  const [findError,setFindError]=useState('');
  const [blockedState,setBlockedState]=useState(false);
  const [searching,setSearching]=useState(false);
  const [sending,setSending]=useState(false);
  const [showEmoji,setShowEmoji]=useState(false);
  const [showGif,setShowGif]=useState(false);
  const [gifs,setGifs]=useState<any[]>([]);
  const [gifSearch,setGifSearch]=useState('');
  const [showMenu,setShowMenu]=useState(false);
  const [showBg,setShowBg]=useState(false);
  const [bg,setBg]=useState(BGS[0]);
  const endRef=useRef<HTMLDivElement>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  const loadChats=async()=>{ try{const r=await apiRequest<any>('/api/chat/list');setChats(r.chats??[]);}catch{} };
  const loadChat=async(id:string)=>{
    setChatLoading(true);
    setError('');
    try{
      const r=await apiRequest<any>(`/api/chat/${id}`);
      const visible = (r.messages ?? []).filter((m:any) => !String(m.body ?? '').startsWith('E2EE1.'));
      setChat(r.chat); setOther(r.other); setMessages(visible); setBg(r.background||BGS[0]); setBlockedState(Boolean(r.blocked));
      setDecrypted(visible.map(decodeChatMessage));
    }catch(e){
      setChat(null);
      setOther(null);
      setError(e instanceof Error?e.message:'Could not open chat.');
    }finally{
      setChatLoading(false);
    }
  };
  useEffect(()=>{void loadChats(); void (async()=>{try{const me=await apiRequest<any>('/api/auth/me');if(me?.user?.id)setCurrentUserId(Number(me.user.id));}catch{}})();},[]);
  useEffect(()=>{
    if(params?.id) {
      void loadChat(params.id);
    } else {
      setChat(null);setOther(null);setMessages([]);
    }
  },[params?.id]);
  useEffect(()=>{
    if(params?.id) return;
    const timer=window.setInterval(()=>void loadChats(),1500);
    return()=>window.clearInterval(timer);
  },[params?.id]);
  const messagesRef=useRef<HTMLElement>(null);
  const shouldAutoScrollRef=useRef(true);
  const lastMessageCountRef=useRef(0);
  const initialScrollDoneRef=useRef(false);
  useEffect(()=>{
    const el=messagesRef.current;
    if(!el || !decrypted.length) return;
    if(!initialScrollDoneRef.current){
      initialScrollDoneRef.current=true;
      lastMessageCountRef.current=decrypted.length;
      requestAnimationFrame(()=>{ el.scrollTop=el.scrollHeight; });
      return;
    }
    const distanceFromBottom=el.scrollHeight-el.scrollTop-el.clientHeight;
    const isNewMessage=decrypted.length>lastMessageCountRef.current;
    if(isNewMessage && distanceFromBottom<160){
      shouldAutoScrollRef.current=true;
      el.scrollTo({top:el.scrollHeight,behavior:'smooth'});
    } else {
      shouldAutoScrollRef.current=distanceFromBottom<160;
    }
    lastMessageCountRef.current=decrypted.length;
  },[decrypted]);
  const touchStart=(e:any,id:number)=>{swipeStartX.current=e.changedTouches[0]?.clientX??null;setSwipeId(id);setSwipeOffset(0);};
  const touchMove=(e:any)=>{const start=swipeStartX.current;if(start===null)return;const x=e.changedTouches[0]?.clientX??start;setSwipeOffset(Math.max(0,Math.min(72,x-start)));};
  const touchEnd=(e:any,m:any)=>{const start=swipeStartX.current;swipeStartX.current=null;const x=e.changedTouches[0]?.clientX??start??0;const distance=x-(start??x);if(distance>42)setReplyTo(m);setSwipeOffset(0);window.setTimeout(()=>setSwipeId(null),180);};

  useEffect(()=>{
    if(!params?.id) return;
    const t=window.setInterval(async()=>{
      try{
        const r=await apiRequest<any>(`/api/chat/${params.id}`);
        const visible = (r.messages ?? []).filter((m:any) => !String(m.body ?? '').startsWith('E2EE1.'));
        setMessages(visible); setOther(r.other); setChat(r.chat); setBlockedState(Boolean(r.blocked));
        setDecrypted(visible.map(decodeChatMessage));
      }catch{}
    },800);
    return()=>window.clearInterval(t);
  },[params?.id,currentUserId]);

  const validateCode=async()=>{
    setFindError('');setError('');setFound(null);const value=code.trim().toUpperCase();
    if(!/^CP-[A-F0-9]{10}$/.test(value)){setFindError('Enter the complete code, for example CP-1A2B3C4D5E.');return;}
    setSearching(true);try{const r=await apiRequest<any>(`/api/users/find/${encodeURIComponent(value)}`);setFound(r.user);}catch(e){setFindError(e instanceof Error?e.message:'User not found.');}finally{setSearching(false);}
  };
  const openFound=async()=>{if(!found)return;try{const r=await apiRequest<any>('/api/chat/open',{method:'POST',body:{userId:found.id}});setCode('');setFound(null);setLocation(`/chat/${r.chatId}`);await loadChats();}catch(e){setError(e instanceof Error?e.message:'Could not open chat.');}};
  const sendMessage=async(extra:any={})=>{
    if(!params?.id || sending || blockedState)return;
    const payload={text:text.trim(), image:extra.image ?? null, gif:extra.gif ?? null, replyToId:replyTo?.id ?? null, replyPreview:replyTo ? (replyTo.decrypted?.text || (replyTo.decrypted?.image ? 'Image' : replyTo.decrypted?.gif ? 'GIF' : 'Message')) : null};
    if(!payload.text&&!payload.image&&!payload.gif)return;
    setSending(true);setError('');
    const optimisticId = -Date.now();
    try{
      const plainBody=JSON.stringify(payload);
      const optimisticMessage = { id: optimisticId, senderId: currentUserId ?? 0, body: plainBody, createdAt: new Date().toISOString() };
      setMessages(m=>[...m,optimisticMessage]);
      setDecrypted(m=>[...m,{...optimisticMessage,decrypted:payload,optimistic:true}]);
      setText('');setReplyTo(null);setShowEmoji(false);setShowGif(false);
      const r=await apiRequest<any>(`/api/chat/${params.id}/message`,{method:'POST',body:{body:plainBody}});
      setMessages(m=>m.map(item=>item.id===optimisticId?r.message:item));
      setDecrypted(m=>m.map(item=>item.id===optimisticId?{...r.message,decrypted:payload}:item));
      void loadChats();
    }catch(e){
      setMessages(m=>m.filter(item=>item.id!==optimisticId));
      setDecrypted(m=>m.filter(item=>item.id!==optimisticId));
      setError(e instanceof Error?e.message:'Could not send message.');
    }finally{setSending(false);}
  };
  const pickImage=async(file?:File)=>{
    if(!file)return;
    if(file.size>8*1024*1024){setError('Images must be under 8MB.');return;}
    try{await sendMessage({image:await dataUrl(file)});}catch{}
  };
  const loadGifs=async(q='trending')=>{try{const r=await apiRequest<any>(`/api/chat/gifs?q=${encodeURIComponent(q)}`);setGifs(r.gifs??[]);if(!r.enabled)setError('GIFs are not enabled yet. Add a GIPHY API key to the server.');}catch(e){setError(e instanceof Error?e.message:'Could not load GIFs.');}};
  const chooseBg=async(value:string)=>{setBg(value);setShowBg(false);if(params?.id)await apiRequest('/api/chat/'+params.id+'/background',{method:'PATCH',body:{background:value}}).catch(()=>{});};

  if(!params?.id)return <div className="cp-page cp-chat-page">
    <PageHeading eyebrow="CIPHERPAY / SOCIAL" title="Find & Chat." detail="Find another CipherPay user with their unique code and start a private conversation." />
    <div className="cp-chat-find-grid">
      <section className="cp-card cp-card-pad cp-chat-find-card">
        <div className="cp-chat-icon"><Search size={22}/></div><span className="cp-kicker">FIND A USER</span><h2>Enter their CipherPay code.</h2><p>Ask the person for their unique code, paste it below, validate it, then start chatting.</p>
        <div className="cp-chat-code-input"><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==='Enter')void validateCode();}} placeholder="CP-XXXXXXXXXX" maxLength={13}/><Button type="button" onClick={()=>void validateCode()} disabled={searching}>{searching?'Checking…':'Validate'}</Button></div>
        {findError&&<Notice tone="error">{findError}</Notice>}
        {found&&<div className="cp-found-user"><CipherAvatar src={found.avatarUrl} seed={found.id||found.email} gender={found.gender} size={58} alt=""/><div><strong>{found.firstName} {found.lastName}</strong><small>{found.email}</small><small>{found.userCode}</small></div><Button type="button" onClick={()=>void openFound()}><MessageCircle size={15}/> Chat</Button></div>}
      </section>
      <section className="cp-card cp-card-pad cp-chat-code-card"><span className="cp-kicker">YOUR CODE</span><h2>Share your code.</h2><p>Your unique code lets other CipherPay users find you without exposing extra personal details.</p><div className="cp-your-code">{/* populated from profile in a lightweight call */}<YourCode/></div></section>
    </div>
    <section className="cp-card cp-card-pad cp-chat-list-card"><div className="cp-card-head"><div><span className="cp-kicker">MESSAGES</span><h2>Your conversations</h2></div></div>{chats.length===0?<div className="cp-chat-empty"><MessageCircle size={28}/><strong>No conversations yet</strong><span>Find someone above to start your first chat.</span></div>:<div className="cp-chat-list">{chats.map((item:any)=><button key={item.id} className={`cp-chat-list-row ${item.unreadCount>0?'has-unread':''}`} onClick={()=>setLocation('/chat/'+item.id)}>
  <CipherAvatar src={item.other.avatarUrl} seed={item.other.id||item.other.email} gender={item.other.gender} size={50} alt=""/>
  <div className="cp-chat-list-copy"><strong>{item.other.firstName} {item.other.lastName}</strong><span>{item.lastMessagePreview || 'Start a conversation'}</span></div>
  <div className="cp-chat-list-meta"><small>{item.lastMessageAt?new Date(item.lastMessageAt).toLocaleDateString('en-NG',{day:'numeric',month:'short'}):''}</small>{item.unreadCount>0&&<b className="cp-chat-unread-badge">{item.unreadCount>99?'99+':item.unreadCount}</b>}</div>
</button>)}</div>}</section>
  </div>;

  if(chatLoading && (!chat || !other))return <div className="cp-page"><LoadingState label="Opening conversation" /></div>;
  if(!chat||!other)return <div className="cp-page"><ErrorState title="Could not open conversation" message={error || 'The conversation could not be loaded.'} action={<Button type="button" onClick={()=>params?.id&&void loadChat(params.id)}>Retry</Button>} /></div>;
  return <div className="cp-page cp-chat-page">
    <style>{`.cp-chat-image{max-width:min(100%,360px)!important;max-height:360px!important;object-fit:contain;cursor:pointer}.cp-chat-gif{width:min(210px,100%)!important;max-width:210px!important;max-height:190px!important;object-fit:contain;border-radius:10px!important}.cp-chat-reply-preview{display:grid;gap:3px;width:100%;padding:7px 9px;border:0;border-left:3px solid #7c5cff;border-radius:7px;background:rgba(20,20,30,.07);color:inherit;text-align:left;cursor:pointer}.cp-chat-reply-preview span{font-size:9px;font-weight:800;opacity:.62}.cp-chat-reply-preview b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600;opacity:.72}.cp-chat-reply-action{justify-self:start;padding:0;border:0;background:transparent;color:#7c5cff;font-size:9px;font-weight:700;cursor:pointer;opacity:.72}.cp-chat-reply-bar{position:absolute;left:10px;right:10px;bottom:70px;display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:#151722;color:#fff;z-index:8;box-shadow:0 10px 30px rgba(0,0,0,.28)}.cp-chat-reply-bar>div{display:grid;gap:2px;min-width:0;flex:1}.cp-chat-reply-bar span{font-size:9px;opacity:.6}.cp-chat-reply-bar b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.cp-chat-reply-bar button{width:28px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;display:grid;place-items:center;cursor:pointer}.cp-chat-bg-picker{background:#151722!important;border-color:rgba(255,255,255,.12)!important;box-shadow:0 14px 35px rgba(0,0,0,.32)}.cp-chat-bg-picker button{box-shadow:0 0 0 1px rgba(255,255,255,.14) inset}`}</style>
    <div className="cp-chat-shell">
      <header className="cp-chat-header"><button className="cp-chat-back" onClick={()=>setLocation('/chat')}><ArrowLeft size={18}/></button><CipherAvatar src={other.avatarUrl} seed={other.id||other.email} gender={other.gender} size={44} alt=""/><div className="cp-chat-person"><strong>{other.firstName} {other.lastName}</strong><span><i className="cp-chat-online-dot"/>CipherPay user · private chat</span></div><div className="cp-chat-head-actions"><button onClick={()=>setShowBg(v=>!v)} title="Chat background"><Palette size={18}/></button><button onClick={()=>setShowMenu(v=>!v)} title="More"><MoreVertical size={18}/></button></div>{showMenu&&<div className="cp-chat-menu"><button onClick={async()=>{setShowMenu(false);try{if(blockedState){await apiRequest('/api/chat/'+chat.id+'/unblock',{method:'POST'});setBlockedState(false);setError('');}else{await apiRequest('/api/chat/'+chat.id+'/block',{method:'POST'});setBlockedState(true);setError('');}}catch(e){setError(e instanceof Error?e.message:'Could not update block status.');}}}><Ban size={15}/> {blockedState?'Unblock user':'Block user'}</button><button onClick={()=>{setShowMenu(false);void apiRequest('/api/chat/'+chat.id,{method:'DELETE'}).then(()=>setLocation('/chat'));}}><Trash2 size={15}/> Delete chat</button></div>}</header>
      {showBg&&<div className="cp-chat-bg-picker">{BGS.map((v,i)=><button key={i} style={{background:v}} onClick={()=>void chooseBg(v)} aria-label={'Background '+(i+1)}/>)}</div>}
      <main ref={messagesRef} className="cp-chat-messages" onScroll={(e)=>{const el=e.currentTarget;shouldAutoScrollRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<120;}} style={{background:bg, backgroundImage:'none'}}>{decrypted.map((m:any)=>{
        const d=m.decrypted||{};
        const target= d.replyToId ? decrypted.find((x:any)=>x.id===Number(d.replyToId)) : null;
        const replyPreview=target?.decrypted?.text || (target?.decrypted?.image ? 'Image' : target?.decrypted?.gif ? 'GIF' : d.replyPreview || null);
        const doReply=()=>setReplyTo(m);
        return <div key={m.id} className={`cp-chat-message-row ${m.senderId===other.id?'incoming':'outgoing'}`} onTouchStart={e=>touchStart(e,m.id)} onTouchMove={touchMove} onTouchEnd={e=>touchEnd(e,m)} style={{transform:swipeId===m.id?`translateX(${swipeOffset}px)`:'translateX(0)',transition:swipeId===m.id?'transform 0s':'transform .18s ease-out',willChange:swipeId===m.id?'transform':'auto'}}>
          <div className="cp-chat-bubble">
            {target&&replyPreview&&<button className="cp-chat-reply-preview" onClick={doReply}><span>↩ {target.senderId===currentUserId?'You':other.firstName}</span><b>{replyPreview}</b></button>}
            {d.image&&<img className="cp-chat-image" src={d.image} alt="Shared image" draggable onDragStart={e=>e.stopPropagation()}/>} {d.gif&&<img className="cp-chat-gif" src={d.gif} alt="GIF" draggable onDragStart={e=>e.stopPropagation()}/>} {d.text&&<span>{d.text}</span>}{d.error&&!d.legacyEncrypted&&<span>Could not display this message.</span>}
            <button className="cp-chat-reply-action" onClick={doReply}>↩ Reply</button>
            <small>{new Date(m.createdAt).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'})}</small>
          </div>
        </div>;
      })}<div ref={endRef}/></main>
      {error&&<div className="cp-chat-error"><X size={14}/>{error}</div>}
      {replyTo&&<div className="cp-chat-reply-bar"><div><span>Replying to {replyTo.senderId===currentUserId?'yourself':other.firstName}</span><b>{replyTo.decrypted?.text || (replyTo.decrypted?.image ? 'Image' : replyTo.decrypted?.gif ? 'GIF' : 'Message')}</b></div><button onClick={()=>setReplyTo(null)}><X size={16}/></button></div>}
      {showEmoji&&<div className="cp-chat-emoji">{EMOJIS.map(e=><button key={e} onClick={()=>setText(v=>v+e)}>{e}</button>)}</div>}
      {showGif&&<div className="cp-chat-gif-panel"><div className="cp-chat-gif-search"><input value={gifSearch} onChange={e=>setGifSearch(e.target.value)} placeholder="Search GIFs"/><button onClick={()=>void loadGifs(gifSearch||'trending')}><Search size={15}/></button></div><div className="cp-gif-grid">{gifs.map(g=><button key={g.id} onClick={()=>void sendMessage({gif:g.url})}><img src={g.url} alt={g.title||'GIF'}/></button>)}</div></div>}
      <footer className="cp-chat-composer"><button onClick={()=>{setShowEmoji(v=>!v);setShowGif(false)}} title="Emoji"><Smile size={20}/></button><button onClick={()=>fileRef.current?.click()} title={blockedState?'Unblock this user to send images':'Image'}><ImageIcon size={20}/></button><button onClick={()=>{const next=!showGif;setShowGif(next);setShowEmoji(false);if(next&&!gifs.length)void loadGifs();}} title={blockedState?'Unblock this user to send GIFs':'GIF'}><span className="cp-gif-label">GIF</span></button><input ref={fileRef} type="file" accept="image/*" hidden onChange={e=>void pickImage(e.target.files?.[0])}/><textarea disabled={blockedState} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage();}}} placeholder={sending?'Sending…':'Write a message…'} rows={1}/><button className="cp-chat-send" onClick={()=>void sendMessage()} disabled={blockedState||sending||!text.trim()}><Send size={18}/></button></footer>
    </div>
  </div>;
}

function YourCode(){
  const [code,setCode]=useState('');
  const [failed,setFailed]=useState(false);
  const [copied,setCopied]=useState(false);
  const load=()=>{setFailed(false);apiRequest<any>('/api/auth/me').then(r=>{if(r.userCode)setCode(r.userCode);else setFailed(true);}).catch(()=>setFailed(true));};
  useEffect(()=>{load();},[]);
  return <>{code?<><strong>{code}</strong><button onClick={()=>{void navigator.clipboard?.writeText(code);setCopied(true);window.setTimeout(()=>setCopied(false),1800)}} title="Copy code"><Copy size={16}/>{copied&&<span className="cp-copy-confirm">Copied</span>}</button></>:failed?<><strong>Couldn’t load your code</strong><button onClick={load} title="Retry"><RefreshCw size={16}/></button></>:<strong>Loading…</strong>}</>;
}
