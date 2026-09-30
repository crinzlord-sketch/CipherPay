import { ArrowLeft, Ban, Check, Copy, Image as ImageIcon, MessageCircle, MoreVertical, Palette, Search, Send, Smile, Trash2, UserRound, X, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { apiRequest } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import { CipherAvatar } from '../components/CipherAvatar';
import { decryptChatPayload, encryptChatPayload, ensureChatKey } from '../lib/chat-crypto';

const EMOJIS = ['😀','😂','😍','🥹','😎','😭','😅','🤝','❤️','🔥','🎉','👏','🙏','💯','🤣','😘','🥰','😮','😢','😡','👍','👎','💙','✨','🚀','🫶','😈','🤔','🙌','💀'];
const BGS = ['#ffffff','#f6f7fb','#f4f1ff','#eef6ff','#f4f8f5','#fff8ef'];

type Person = { id:number; firstName:string; lastName:string; email:string; avatarUrl?:string|null; gender?:string|null; userCode?:string|null; chatPublicKey?:string|null };
type Message = { id:number; senderId:number; body?:string|null; imageUrl?:string|null; gifUrl?:string|null; createdAt:string };

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
  const [messages,setMessages]=useState<Message[]>([]);
  const [decrypted,setDecrypted]=useState<any[]>([]);
  const [other,setOther]=useState<Person|null>(null);
  const [currentUserId,setCurrentUserId]=useState<number|null>(null);
  const [replyTo,setReplyTo]=useState<any|null>(null);
  const swipeStartX=useRef<number|null>(null);
  const [text,setText]=useState('');
  const [error,setError]=useState('');
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
    try{
      const r=await apiRequest<any>(`/api/chat/${id}`);
      setChat(r.chat); setOther(r.other); setMessages(r.messages??[]); setBg(r.background||BGS[0]);
      if(r.other?.chatPublicKey){
        const decoded=await Promise.all((r.messages??[]).map(async (m:any)=>{
          try { return { ...m, decrypted: await decryptChatPayload(Number(id), JSON.parse((m.senderId === currentUserId ? r.other.chatPublicKey : m.senderPublicKey) || 'null'), String(m.body??'')) }; }
          catch { return { ...m, decrypted: { error: true } }; }
        }));
        setDecrypted(decoded);
      } else setDecrypted((r.messages??[]).map((m:any)=>({...m,decrypted:{error:true}})));
    }catch(e){setError(e instanceof Error?e.message:'Could not open chat.');}
  };
  useEffect(()=>{void loadChats(); void (async()=>{try{const me=await apiRequest<any>('/api/auth/me');if(me?.user?.id)setCurrentUserId(Number(me.user.id));}catch{} try{const key=await ensureChatKey(); await apiRequest('/api/auth/chat-key',{method:'POST',body:{publicKey:JSON.stringify(key)}});}catch(e){setError(e instanceof Error?e.message:'Secure chat encryption could not be initialized.');}})();},[]);
  useEffect(()=>{if(params?.id) void loadChat(params.id); else {setChat(null);setOther(null);setMessages([]);}},[params?.id]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'});},[decrypted.length]);

  useEffect(()=>{
    if(!params?.id) return;
    const t=window.setInterval(async()=>{
      try{
        const r=await apiRequest<any>(`/api/chat/${params.id}`);
        setMessages(r.messages??[]); setOther(r.other); setChat(r.chat);
        if(r.other?.chatPublicKey){
          const key=JSON.parse(r.other.chatPublicKey);
          const decoded=await Promise.all((r.messages??[]).map(async (m:any)=>{try{return {...m,decrypted:await decryptChatPayload(Number(params.id),JSON.parse((m.senderId === currentUserId ? r.other.chatPublicKey : m.senderPublicKey) || 'null'),String(m.body??''))};}catch{return {...m,decrypted:{error:true}};}}));
          setDecrypted(decoded);
        }
      }catch{}
    },2500);
    return()=>window.clearInterval(t);
  },[params?.id,currentUserId]);

  const validateCode=async()=>{
    setError('');setFound(null);const value=code.trim().toUpperCase();
    if(!/^CP-[A-F0-9]{10}$/.test(value)){setError('Enter the complete code, for example CP-1A2B3C4D5E.');return;}
    setSearching(true);try{const r=await apiRequest<any>(`/api/users/find/${encodeURIComponent(value)}`);setFound(r.user);}catch(e){setError(e instanceof Error?e.message:'User not found.');}finally{setSearching(false);}
  };
  const openFound=async()=>{if(!found)return;try{const r=await apiRequest<any>('/api/chat/open',{method:'POST',body:{userId:found.id}});setCode('');setFound(null);setLocation(`/chat/${r.chatId}`);await loadChats();}catch(e){setError(e instanceof Error?e.message:'Could not open chat.');}};
  const sendMessage=async(extra:any={})=>{
    if(!params?.id || sending)return;
    const payload={text:text.trim(), image:extra.image ?? null, gif:extra.gif ?? null, replyToId:replyTo?.id ?? null, replyPreview:replyTo ? (replyTo.decrypted?.text || (replyTo.decrypted?.image ? 'Image' : replyTo.decrypted?.gif ? 'GIF' : 'Message')) : null};
    if(!payload.text&&!payload.image&&!payload.gif)return;
    if(!other?.chatPublicKey){setError('This chat is not ready for end-to-end encryption yet.');return;}
    setSending(true);setError('');
    try{
      const ciphertext=await encryptChatPayload(Number(params.id),JSON.parse(other.chatPublicKey),payload);
      const r=await apiRequest<any>(`/api/chat/${params.id}/message`,{method:'POST',body:{body:ciphertext}});
      setMessages(m=>[...m,r.message]);
      setDecrypted(m=>[...m,{...r.message,decrypted:payload}]);
      setText('');setReplyTo(null);setShowEmoji(false);setShowGif(false);void loadChats();
    }catch(e){setError(e instanceof Error?e.message:'Could not send encrypted message.');}finally{setSending(false);}
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
        {error&&<Notice tone="error">{error}</Notice>}
        {found&&<div className="cp-found-user"><CipherAvatar src={found.avatarUrl} seed={found.id||found.email} gender={found.gender} size={58} alt=""/><div><strong>{found.firstName} {found.lastName}</strong><small>{found.email}</small><small>{found.userCode}</small></div><Button type="button" onClick={()=>void openFound()}><MessageCircle size={15}/> Chat</Button></div>}
      </section>
      <section className="cp-card cp-card-pad cp-chat-code-card"><span className="cp-kicker">YOUR CODE</span><h2>Share your code.</h2><p>Your unique code lets other CipherPay users find you without exposing extra personal details.</p><div className="cp-your-code">{/* populated from profile in a lightweight call */}<YourCode/></div></section>
    </div>
    <section className="cp-card cp-card-pad cp-chat-list-card"><div className="cp-card-head"><div><span className="cp-kicker">MESSAGES</span><h2>Your conversations</h2></div></div>{chats.length===0?<div className="cp-chat-empty"><MessageCircle size={28}/><strong>No conversations yet</strong><span>Find someone above to start your first chat.</span></div>:<div className="cp-chat-list">{chats.map((item:any)=><button key={item.id} className="cp-chat-list-row" onClick={()=>setLocation('/chat/'+item.id)}><CipherAvatar src={item.other.avatarUrl} seed={item.other.id||item.other.email} gender={item.other.gender} size={50} alt=""/><div><strong>{item.other.firstName} {item.other.lastName}</strong><span>{item.lastMessage?.body ? '🔒 Encrypted message' : 'Start a conversation'}</span></div><small>{item.lastMessageAt?new Date(item.lastMessageAt).toLocaleDateString('en-NG',{day:'numeric',month:'short'}):''}</small></button>)}</div>}</section>
  </div>;

  if(!chat||!other)return <div className="cp-page"><LoadingState label="Opening conversation" /></div>;
  return <div className="cp-page cp-chat-page">
    <div className="cp-chat-shell">
      <header className="cp-chat-header"><button className="cp-chat-back" onClick={()=>setLocation('/chat')}><ArrowLeft size={18}/></button><CipherAvatar src={other.avatarUrl} seed={other.id||other.email} gender={other.gender} size={44} alt=""/><div className="cp-chat-person"><strong>{other.firstName} {other.lastName}</strong><span>{other.userCode}</span></div><div className="cp-chat-head-actions"><button onClick={()=>setShowBg(v=>!v)} title="Chat background"><Palette size={18}/></button><button onClick={()=>setShowMenu(v=>!v)} title="More"><MoreVertical size={18}/></button></div>{showMenu&&<div className="cp-chat-menu"><button onClick={()=>{setShowMenu(false);void apiRequest('/api/chat/'+chat.id+'/block',{method:'POST'}).then(()=>setError('User blocked.'));}}><Ban size={15}/> Block user</button><button onClick={()=>{setShowMenu(false);void apiRequest('/api/chat/'+chat.id,{method:'DELETE'}).then(()=>setLocation('/chat'));}}><Trash2 size={15}/> Delete chat</button></div>}</header>
      {showBg&&<div className="cp-chat-bg-picker">{BGS.map((v,i)=><button key={i} style={{background:v}} onClick={()=>void chooseBg(v)} aria-label={'Background '+(i+1)}/>)}</div>}
      <main className="cp-chat-messages" style={{background:bg, backgroundImage:'none'}}>{decrypted.map((m:any)=>{
        const d=m.decrypted||{};
        const target= d.replyToId ? decrypted.find((x:any)=>x.id===Number(d.replyToId)) : null;
        const replyPreview=target?.decrypted?.text || (target?.decrypted?.image ? 'Image' : target?.decrypted?.gif ? 'GIF' : d.replyPreview || null);
        const doReply=()=>setReplyTo(m);
        return <div key={m.id} className={`cp-chat-message-row ${m.senderId===other.id?'incoming':'outgoing'}`} onTouchStart={e=>{swipeStartX.current=e.changedTouches[0]?.clientX??null}} onTouchEnd={e=>{const start=swipeStartX.current;swipeStartX.current=null;const end=e.changedTouches[0]?.clientX??start??0;if(start!==null&&end-start>55)doReply();}}>
          <div className="cp-chat-bubble">
            {target&&replyPreview&&<button className="cp-chat-reply-preview" onClick={doReply}><span>↩ {target.senderId===currentUserId?'You':other.firstName}</span><b>{replyPreview}</b></button>}
            {d.image&&<img className="cp-chat-image" src={d.image} alt="Shared image" draggable onDragStart={e=>e.stopPropagation()}/>} {d.gif&&<img className="cp-chat-gif" src={d.gif} alt="GIF" draggable onDragStart={e=>e.stopPropagation()}/>} {d.text&&<span>{d.text}</span>}{d.error&&<span>🔒 Encrypted message</span>}
            <button className="cp-chat-reply-action" onClick={doReply}>↩ Reply</button>
            <small>{new Date(m.createdAt).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'})}</small>
          </div>
        </div>;
      })}<div ref={endRef}/></main>
      {error&&<div className="cp-chat-error"><X size={14}/>{error}</div>}
      {replyTo&&<div className="cp-chat-reply-bar"><div><span>Replying to {replyTo.senderId===currentUserId?'yourself':other.firstName}</span><b>{replyTo.decrypted?.text || (replyTo.decrypted?.image ? 'Image' : replyTo.decrypted?.gif ? 'GIF' : 'Message')}</b></div><button onClick={()=>setReplyTo(null)}><X size={16}/></button></div>}
      {showEmoji&&<div className="cp-chat-emoji">{EMOJIS.map(e=><button key={e} onClick={()=>setText(v=>v+e)}>{e}</button>)}</div>}
      {showGif&&<div className="cp-chat-gif-panel"><div className="cp-chat-gif-search"><input value={gifSearch} onChange={e=>setGifSearch(e.target.value)} placeholder="Search GIFs"/><button onClick={()=>void loadGifs(gifSearch||'trending')}><Search size={15}/></button></div><div className="cp-gif-grid">{gifs.map(g=><button key={g.id} onClick={()=>void sendMessage({gif:g.url})}><img src={g.url} alt={g.title||'GIF'}/></button>)}</div></div>}
      <footer className="cp-chat-composer"><button onClick={()=>{setShowEmoji(v=>!v);setShowGif(false)}} title="Emoji"><Smile size={20}/></button><button onClick={()=>fileRef.current?.click()} title="Image"><ImageIcon size={20}/></button><button onClick={()=>{const next=!showGif;setShowGif(next);setShowEmoji(false);if(next&&!gifs.length)void loadGifs();}} title="GIF"><span className="cp-gif-label">GIF</span></button><input ref={fileRef} type="file" accept="image/*" hidden onChange={e=>void pickImage(e.target.files?.[0])}/><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendMessage();}}} placeholder={sending?'Sending…':'Write a message…'} rows={1}/><button className="cp-chat-send" onClick={()=>void sendMessage()} disabled={sending||!text.trim()}><Send size={18}/></button></footer>
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
