import { createHmac } from "node:crypto";
import { fetch as undiciFetch } from "undici";

const BASE = (process.env.OPAY_ENV ?? "sandbox").toLowerCase() === "production"
  ? "https://liveapi.opaycheckout.com/api/v1/international"
  : "https://testapi.opaycheckout.com/api/v1/international";
const PUBLIC_KEY = () => process.env.OPAY_PUBLIC_KEY?.trim();
const SECRET_KEY = () => process.env.OPAY_SECRET_KEY?.trim();
const MERCHANT_ID = () => process.env.OPAY_MERCHANT_ID?.trim();

function requireConfig() {
  const merchantId = MERCHANT_ID(), publicKey = PUBLIC_KEY(), secretKey = SECRET_KEY();
  if (!merchantId || !publicKey || !secretKey) throw new Error("OPay API credentials are not configured");
  return { merchantId, publicKey, secretKey };
}
function sign(payload: unknown, secretKey: string) { return createHmac("sha512", secretKey).update(JSON.stringify(payload)).digest("hex"); }
async function opayPost<T = any>(path: string, payload: Record<string, unknown>, signed = true): Promise<{ status: number; body: T }> {
  const { merchantId, publicKey, secretKey } = requireConfig();
  const body = JSON.stringify(payload);
  const authorization = signed ? sign(payload, secretKey) : publicKey;
  const res = await undiciFetch(`${BASE}${path}`, { method:"POST", headers:{ "Content-Type":"application/json", Accept:"application/json", Authorization:`Bearer ${authorization}`, MerchantId:merchantId }, body });
  return { status:res.status, body:await res.json().catch(()=>({})) as T };
}
export function opayReference(suffix?: string) { return `CP-OPAY-${Date.now().toString(36)}-${suffix ?? Math.random().toString(36).slice(2,8)}`.slice(0,64); }

export async function createCashierPayment(params: { reference:string; amount:number; email?:string; name?:string; phone?:string; callbackUrl:string; returnUrl:string; }) {
  const payload={country:"NG",reference:params.reference,amount:{currency:"NGN",total:Math.round(params.amount*100)},callbackUrl:params.callbackUrl,returnUrl:params.returnUrl,cancelUrl:params.returnUrl,expireAt:30,product:{name:"CipherPay wallet funding",description:"Add money to your CipherPay wallet"},userInfo:{userId:params.reference,userName:params.name??"",userMobile:params.phone??"",userEmail:params.email??""},customerVisitSource:"BROWSER"};
  const {status,body}=await opayPost<any>("/cashier/create",payload,false);
  if(status<200||status>=300||body?.code!=="00000"||!body?.data?.cashierUrl) throw new Error(body?.message||"OPay could not create the payment checkout");
  return {reference:String(body.data.reference??params.reference),orderNo:String(body.data.orderNo??""),cashierUrl:String(body.data.cashierUrl),status:String(body.data.status??"PENDING"),amount:Number(body.data.amount?.total??Math.round(params.amount*100))/100};
}

export async function createCardPayment(params: { reference:string; amount:number; cardNumber:string; cardHolderName:string; expiryMonth:string; expiryYear:string; cvv:string; callbackUrl:string; returnUrl:string; email?:string; name?:string; phone?:string; }) {
  const payload={amount:{currency:"NGN",total:Math.round(params.amount*100)},bankcard:{cardHolderName:params.cardHolderName,cardNumber:params.cardNumber,cvv:params.cvv,enable3DS:true,expiryMonth:params.expiryMonth,expiryYear:params.expiryYear},callbackUrl:params.callbackUrl,returnUrl:params.returnUrl,country:"NG",payMethod:"BankCard",product:{name:"CipherPay wallet funding",description:"Add money to your CipherPay wallet"},reference:params.reference,userInfo:{userEmail:params.email??"",userId:params.reference,userMobile:params.phone??"",userName:params.name??""}};
  const {status,body}=await opayPost<any>("/payment/create",payload,true);
  if(status<200||status>=300||body?.code!=="00000") throw new Error(body?.message||"OPay could not create the card payment");
  return {reference:String(body.data?.reference??params.reference),orderNo:String(body.data?.orderNo??""),cashierUrl:body.data?.cashierUrl?String(body.data.cashierUrl):null,redirectUrl:body.data?.nextAction?.redirectUrl?String(body.data.nextAction.redirectUrl):null,status:String(body.data?.status??"PENDING"),amount:Number(body.data?.amount?.total??Math.round(params.amount*100))/100};
}

export async function createBankTransferPayment(params: { reference:string; amount:number; callbackUrl:string; returnUrl:string; email?:string; name?:string; phone?:string; }) {
  const payload={amount:{currency:"NGN",total:Math.round(params.amount*100)},callbackUrl:params.callbackUrl,returnUrl:params.returnUrl,country:"NG",expireAt:30,payMethod:"BankTransfer",product:{name:"CipherPay wallet funding",description:"Add money to your CipherPay wallet"},reference:params.reference,customerName:params.name??"",userClientIP:"",userPhone:params.phone??"",userInfo:{userEmail:params.email??"",userId:params.reference,userMobile:params.phone??"",userName:params.name??""}};
  const {status,body}=await opayPost<any>("/payment/create",payload,true);
  const action=body?.data?.nextAction;
  if(status<200||status>=300||body?.code!=="00000"||action?.actionType!=="TRANSFER_ACCOUNT") throw new Error(body?.message||"OPay could not create the transfer account");
  return {reference:String(body.data.reference??params.reference),orderNo:String(body.data.orderNo??""),accountNumber:String(action.transferAccountNumber),bankName:String(action.transferBankName),expiresAt:action.expiredTimestamp?new Date(Number(action.expiredTimestamp)*1000).toISOString():null,amount:Number(body.data.amount?.total??Math.round(params.amount*100))/100};
}

export async function queryPaymentStatus(reference:string) {
  const payload={reference,country:"NG"}; const {status,body}=await opayPost<any>("/cashier/status",payload,true);
  if(status<200||status>=300||body?.code!=="00000") throw new Error(body?.message||"OPay payment status lookup failed");
  return {status:String(body?.data?.status??"INITIAL").toUpperCase(),amount:Number(body?.data?.amount?.total??0)/100,currency:String(body?.data?.amount?.currency??"NGN"),orderNo:String(body?.data?.orderNo??""),raw:body};
}
export function verifyCallbackSignature(input:{amount:string;currency:string;reference:string;refunded:boolean;status:string;timestamp:string;token?:string|null;transactionId:string;sha512:string}) {
  const secretKey=SECRET_KEY(); if(!secretKey)return false;
  const content=`{Amount:"${input.amount}",Currency:"${input.currency}",Reference:"${input.reference}",Refunded:${input.refunded?"t":"f"},Status:"${input.status}",Timestamp:"${input.timestamp}",Token:"${input.token??""}",TransactionID:"${input.transactionId}"}`;
  return createHmac("sha3-512",secretKey).update(content).digest("hex").toLowerCase()===String(input.sha512).toLowerCase();
}
export function friendlyOpayError(raw?:string|null) {
  const m=String(raw??"").toLowerCase();
  if(/authentication|unauthori|invalid.*key/.test(m)) return "OPay payment authentication failed. Check the test keys and merchant ID.";
  if(/merchant.*not|02002/.test(m)) return "This OPay payment method is not enabled for the CipherPay merchant account yet.";
  if(/not support|02003/.test(m)) return "This OPay payment method is not enabled for the CipherPay merchant account yet.";
  if(/duplicate|already exists|02004/.test(m)) return "This payment was already submitted. Check your transactions before trying again.";
  return "We could not start the OPay payment. Please try again shortly.";
}