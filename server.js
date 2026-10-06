import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __filename=fileURLToPath(import.meta.url),__dirname=path.dirname(__filename);
const app=express(),PORT=Number(process.env.PORT||3000),MODEL=process.env.GROQ_MODEL||'qwen/qwen3.8-27b';
const groq=process.env.GROQ_API_KEY?new OpenAI({apiKey:process.env.GROQ_API_KEY,baseURL:'https://api.groq.com/openai/v1'}):null;
app.use(express.json({limit:'60mb'}));app.use(express.static(path.join(__dirname,'public')));
app.get('/api/health',(_,r)=>r.json({ok:true,aiEnabled:!!groq,model:MODEL}));
const schema={name:'serial_extraction',strict:true,schema:{type:'object',additionalProperties:false,properties:{productName:{type:'string'},model:{type:'string'},serialNumbers:{type:'array',items:{type:'string'}},confidence:{type:'string',enum:['high','medium','low']},notes:{type:'string'}},required:['productName','model','serialNumbers','confidence','notes']}};
app.post('/api/analyze',async(req,res)=>{if(!groq)return res.status(503).json({ok:false,error:'GROQ_API_KEY is not configured.'});const {imageDataUrl,ocrText='',barcodeCandidates=[]}=req.body||{};if(!imageDataUrl)return res.status(400).json({ok:false,error:'imageDataUrl is required.'});
const prompt=`Extract inventory data from this product-label image for a Tally ERP workflow. Return ONLY the supplied JSON schema.

CRITICAL INSTRUCTIONS:
1. Extract EVERY visible SERIAL NUMBER IN FULL. NEVER truncate, abbreviate, or output ellipses ('...') for any serial number under any circumstances! Output every single character of the full serial number completely (e.g. 57CAZP198MKZCT8U, 5Q5JU0JENAB0PSNC).
2. Extract the exact Model Name/Number (e.g. CP-UNR-104F1, Latitude 5420).
3. Prefer fields labeled Serial Number, Serial No, Serial, S/N, or SN.
4. If multiple serial numbers are on the label, return ALL of them completely.
5. Do NOT include EAN/UPC/GTIN/MAC/IMEI/Voltage/Date/Batch unless explicitly labeled as Serial.

OCR Hint:
${String(ocrText).slice(0,12000)}

Barcode Candidates:
${JSON.stringify(Array.isArray(barcodeCandidates)?barcodeCandidates.slice(0,30):[])}`;

try{const c=await groq.chat.completions.create({model:MODEL,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:imageDataUrl}}]}],temperature:0,max_completion_tokens:3000,response_format:{type:'json_schema',json_schema:schema}});const x=JSON.parse(c.choices?.[0]?.message?.content||'{}');x.productName=String(x.productName||'').trim();x.model=String(x.model||'').trim();x.serialNumbers=Array.isArray(x.serialNumbers)?x.serialNumbers.map(v=>String(v||'').replace(/\.{2,}|…/g,'').trim()).filter(Boolean):[];x.notes=String(x.notes||'').trim();res.json({ok:true,model:MODEL,result:x});}catch(e){console.error(e);res.status(e?.status===429?429:500).json({ok:false,error:e?.status===429?'Groq rate limit reached.':e?.message||'AI analysis failed.'})}});
app.use((req,res)=>req.path.startsWith('/api/')?res.status(404).json({ok:false,error:'API route not found.'}):res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Product Serial Scanner: http://localhost:${PORT}`));
