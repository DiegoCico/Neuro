import React, { useEffect, useState } from "react";
import "../css/Home.css";
import Header from "../components/Header";
import { fetchUserNames } from "../userProfile";

export type Post = {
  id: string;
  author: string;
  timestamp: string;
  text?: string;
  imageUrl?: string; // reserved for future (Storage)
  likes: number;
  comments: number;
};

export default function Home() {
  const [query, setQuery] = useState("");
  const [firstName, setFirstName] = useState("User");

  useEffect(() => {
    fetchUserNames().then(({ firstName }) => setFirstName(firstName));
  }, []);

  return (
    <div>   
        <Header onSearch={(q) => setQuery(q)} />
    </div>
  );
}
