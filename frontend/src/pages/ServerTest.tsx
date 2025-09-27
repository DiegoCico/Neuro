import { useState, useEffect } from 'react'
import {API_URL} from '../config'

export default function ServerTest() {
    const [serverStatus, setServerStatus] = useState('')
    const [error, setError] = useState('')
    
    useEffect(() => {
        const serverTest = async() => {
            try {
                const connect = await fetch(`${API_URL}/api/hello`, {
                    method: 'GET',
                    headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                })

                if (connect.ok) {
                    const response = await connect.json()
                    setServerStatus(response.message)
                }
                console.log(serverStatus)
            } catch (error) {
                setError('Failure to connect to server')
            }
        }

        serverTest()
    })

    return (
        <div>
            {error ? (
                <div className='error-cont'>
                    <h2>{error}</h2>
                </div>
            ) : (
                <div className='message-cont'>
                    <h2>{serverStatus}</h2>
                </div>
            )}
        </div>
    )
}