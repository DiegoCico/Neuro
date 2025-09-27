import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons";

export default function NeuroLogo({ size = 24 }: { size?: number }) {
  return (
    <div>
        <FontAwesomeIcon icon={faShareNodes} className="brand-icon" />
        </div>
  );
}
