import axios from "axios";


//headers: {
//  "Access-Control-Allow-Origin": "*",
//  "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept"
//}
export default  axios.create({
  baseURL: "http://127.0.0.1:8000",
});
