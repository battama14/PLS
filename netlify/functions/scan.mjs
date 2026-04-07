
import fs from 'fs'
import fetch from 'node-fetch'

const RPC="https://rpc.pulsechain.com"
const FILE="./site_data.json"
const WHALE_THRESHOLD = 500000000 // 500M PLS pour cohérence avec indexer

async function rpc(method,params){
 const r=await fetch(RPC,{
  method:"POST",
  headers:{"content-type":"application/json"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})
 })
 const j=await r.json()
 return j.result
}

function load(){
 return JSON.parse(fs.readFileSync(FILE))
}

function save(d){
 fs.writeFileSync(FILE,JSON.stringify(d,null,2))
}

function addWhale(data,wallet,amount,type){

 data.last_whales.unshift({
  wallet,
  amount_pls:amount,
  type,
  time:Date.now()
 })

 if(data.last_whales.length>100){
  data.last_whales.pop()
 }

}

function updateStats(data,amount,type){

 const tf=data.timeframes.all

 tf.tx++

 if(type==="buy") {
   tf.buys+=amount
   tf.netflow.buy_pls += amount
 } else {
   tf.sells+=amount
   tf.netflow.sell_pls += amount
 }

 tf.net=tf.buys-tf.sells
 tf.netflow.total_flow_pls = tf.buys + tf.sells
 tf.netflow.netflow_pls = tf.net
 tf.netflow.tx_count = tf.tx

}

async function scanBlock(block){

 const blockData=await rpc("eth_getBlockByNumber",[
  "0x"+block.toString(16),
  true
 ])

 if(!blockData) return

 const data=load()

 for(const tx of blockData.transactions){

  const value=parseInt(tx.value)/1e18

  if(value>WHALE_THRESHOLD){

   // Déterminer le type basé sur la transaction réelle
   let type = "buy"
   
   // Si c'est un swap vers PulseX Router, c'est probablement une vente
   if(tx.to && tx.to.toLowerCase() === "0x98bf93ebf5c380c0e6ae8e192a7e2ae08edacc02") {
     type = "sell"
   }
   
   // Si l'input n'est pas vide, c'est probablement un swap/interaction
   if(tx.input && tx.input !== "0x" && tx.input.length > 10) {
     // Analyser les 4 premiers bytes pour déterminer la méthode
     const method = tx.input.slice(0, 10)
     if(["0x38ed1739", "0x7ff36ab5", "0x18cbafe5"].includes(method)) {
       type = "sell" // Méthodes de swap typiques
     }
   }

   addWhale(data,tx.from,value,type)

   updateStats(data,value,type)

   console.log("🐋 Whale detected:",value,"PLS")

  }

 }

 data.meta.last_block=block
 data.meta.updated_at=Date.now()

 save(data)

}

async function loop(){

 let latest=parseInt(await rpc("eth_blockNumber",[]),16)

 const data=load()

 let current=data.meta.last_block || latest

 while(true){

  const newBlock=parseInt(await rpc("eth_blockNumber",[]),16)

  if(newBlock>current){

   current++

   await scanBlock(current)

  }

  await new Promise(r=>setTimeout(r,3000))

 }

}

loop()
