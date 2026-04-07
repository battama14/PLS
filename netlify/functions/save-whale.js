
import fs from 'fs'

const FILE="./site_data.json"

export function saveWhale(wallet,amount){

 const data=JSON.parse(fs.readFileSync(FILE))

 data.last_whales.unshift({
  wallet,
  amount_pls:amount,
  time:Date.now()
 })

 if(data.last_whales.length>100){
  data.last_whales.pop()
 }

 fs.writeFileSync(FILE,JSON.stringify(data,null,2))

}
